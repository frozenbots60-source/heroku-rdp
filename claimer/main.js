/**
 * Captcha Detection and Hardware Click Bridge
 * 
 * This extension detects Cloudflare Turnstile captcha and sends coordinates
 * to a Python backend that performs hardware-level clicks via xdotool.
 * 
 * The key challenge: JavaScript click events are detected by Cloudflare as synthetic.
 * Solution: Use xdotool via Python to generate X11-level input events that appear
 * as hardware input to applications running under XRDP.
 */

(function() {
    'use strict';

    // ================================
    // CONFIGURATION
    // ================================
    const CONFIG = {
        // Local WebSocket server (Python backend)
        HARDWARE_CLICK_SERVER: "ws://127.0.0.1:8765",
        
        // Backend WSS URL (your existing server)
        BACKEND_WSS_URL: "wss://wss-api-5ca5596e4af3.herokuapp.com/ws",
        
        // Captcha detection settings
        CAPTCHA_CHECK_INTERVAL: 1000,  // Check every 1 second
        CAPTCHA_SELECTORS: [
            '#cf-turnstile',
            '[id^="cf-chl-widget"]',
            'iframe[src*="challenges.cloudflare.com"]',
            'iframe[src*="turnstile"]',
            '.cf-turnstile',
            '#challenge-form',
            'div[class*="turnstile"]',
            'iframe[title*="Widget containing a Cloudflare security challenge"]'
        ],
        
        // Click target within captcha iframe
        TURNSTILE_CLICK_SELECTORS: [
            'input[type="checkbox"]',
            '.ctp-checkbox-label',
            'label',
            '[role="checkbox"]',
            '.mark',
            '.ctp-checkbox'
        ]
    };

    // ================================
    // CSS STYLES
    // ================================
    const style = document.createElement('style');
    style.innerHTML = `
        .ai-tap-ripple {
            position: absolute; width: 40px; height: 40px; background: rgba(255, 0, 0, 0.7);
            border-radius: 50%; pointer-events: none; transform: translate(-50%, -50%);
            animation: ripple-out 0.8s ease-out forwards; z-index: 9999999;
        }
        @keyframes ripple-out {
            from { transform: translate(-50%, -50%) scale(0); opacity: 1; }
            to { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
        #copilot-ui-bridge {
            position: fixed; bottom: 20px; right: 20px; width: 380px; height: 500px;
            background: #ffffff; border: 1px solid #dfe1e5; border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; flex-direction: column;
            z-index: 2147483647; font-family: 'Segoe UI', system-ui, sans-serif;
        }
        #ui-header { padding: 15px; background: #0078d4; color: white; border-radius: 12px 12px 0 0; font-weight: 600; display: flex; justify-content: space-between; }
        #chat-area { flex: 1; overflow-y: auto; padding: 15px; background: #f9f9f9; display: flex; flex-direction: column; gap: 12px; }
        .msg { padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.5; max-width: 85%; }
        .user-msg { align-self: flex-end; background: #0078d4; color: white; }
        .ai-msg { align-self: flex-start; background: #fff; border: 1px solid #e0e0e0; color: #333; white-space: pre-wrap; }
        #input-box { padding: 15px; border-top: 1px solid #eee; display: flex; gap: 8px; }
        #user-prompt { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 6px; outline: none; }
        #send-trigger { padding: 10px 18px; background: #0078d4; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .status-dot { width: 10px; height: 10px; background: #ff4d4d; border-radius: 50%; display: inline-block; margin-left: 5px; }
        .status-dot.connected { background: #00ff00; }
        .captcha-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(255, 165, 0, 0.3); z-index: 2147483646;
            pointer-events: none; display: flex; align-items: center; justify-content: center;
        }
        .captcha-overlay::after {
            content: '🤖 CAPTCHA DETECTED - Requesting hardware click...';
            background: rgba(0,0,0,0.8); color: white; padding: 20px 40px;
            border-radius: 10px; font-size: 18px; font-family: system-ui;
        }
    `;
    document.head.appendChild(style);

    // ================================
    // UTILITIES
    // ================================
    window.showTap = function(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'ai-tap-ripple';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 800);
    };

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    // FIX: Native setter helper for React inputs (Ensures 'input' event is trusted by frameworks)
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ================================
    // HARDWARE CLICK BRIDGE
    // ================================
    class HardwareClickBridge {
        constructor() {
            this.ws = null;
            this.connected = false;
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 10;
        }

        connect() {
            return new Promise((resolve, reject) => {
                try {
                    this.ws = new WebSocket(CONFIG.HARDWARE_CLICK_SERVER);
                    
                    this.ws.onopen = () => {
                        console.log("🔌 Hardware Click Server connected");
                        this.connected = true;
                        this.reconnectAttempts = 0;
                        updateStatusDot('hardware', true);
                        resolve();
                    };
                    
                    this.ws.onclose = () => {
                        this.connected = false;
                        updateStatusDot('hardware', false);
                        console.log("❌ Hardware Click Server disconnected");
                        
                        // Auto reconnect
                        if (this.reconnectAttempts < this.maxReconnectAttempts) {
                            this.reconnectAttempts++;
                            setTimeout(() => this.connect(), 2000);
                        }
                    };
                    
                    this.ws.onerror = (err) => {
                        console.error("Hardware Click Server error:", err);
                        reject(err);
                    };
                    
                    this.ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            console.log("📥 Hardware click response:", data);
                        } catch (e) {}
                    };
                    
                } catch (e) {
                    reject(e);
                }
            });
        }

        async sendClick(x, y, elementType = 'unknown', iframeOffset = null) {
            if (!this.connected) {
                console.warn("⚠️ Hardware click server not connected");
                return false;
            }

            const message = {
                action: "captcha_detected",
                x: Math.round(x),
                y: Math.round(y),
                captcha_type: "cloudflare-turnstile",
                element_type: elementType
            };

            if (iframeOffset) {
                message.iframe = iframeOffset;
            }

            console.log("📤 Sending hardware click request:", message);
            
            return new Promise((resolve) => {
                try {
                    this.ws.send(JSON.stringify(message));
                    resolve(true);
                } catch (e) {
                    console.error("Failed to send click request:", e);
                    resolve(false);
                }
            });
        }

        async ping() {
            if (!this.connected) return false;
            
            return new Promise((resolve) => {
                try {
                    this.ws.send(JSON.stringify({ action: "ping" }));
                    resolve(true);
                } catch (e) {
                    resolve(false);
                }
            });
        }
    }

    // ================================
    // CAPTCHA DETECTOR
    // ================================
    class CaptchaDetector {
        constructor(hardwareBridge) {
            this.hardwareBridge = hardwareBridge;
            this.isProcessing = false;
            this.lastCaptchaTime = 0;
            this.captchaCooldown = 5000; // 5 seconds between attempts
            this.observer = null;
        }

        start() {
            console.log("🔍 Starting Captcha Detector...");
            
            // Initial check
            this.checkForCaptcha();
            
            // Periodic check
            setInterval(() => this.checkForCaptcha(), CONFIG.CAPTCHA_CHECK_INTERVAL);
            
            // MutationObserver for dynamic content
            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (this.isCaptchaElement(node)) {
                                this.handleCaptchaDetected(node);
                                return;
                            }
                            // Check children
                            const captchaChild = node.querySelector(CONFIG.CAPTCHA_SELECTORS.join(','));
                            if (captchaChild) {
                                this.handleCaptchaDetected(captchaChild);
                                return;
                            }
                        }
                    }
                }
            });
            
            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        isCaptchaElement(element) {
            return CONFIG.CAPTCHA_SELECTORS.some(selector => {
                try {
                    return element.matches && element.matches(selector);
                } catch (e) {
                    return false;
                }
            });
        }

        checkForCaptcha() {
            if (this.isProcessing) return;
            
            for (const selector of CONFIG.CAPTCHA_SELECTORS) {
                const element = document.querySelector(selector);
                if (element) {
                    this.handleCaptchaDetected(element);
                    return;
                }
            }
        }

        async handleCaptchaDetected(element) {
            // Cooldown check
            const now = Date.now();
            if (now - this.lastCaptchaTime < this.captchaCooldown) {
                return;
            }
            
            if (this.isProcessing) return;
            this.isProcessing = true;
            this.lastCaptchaTime = now;
            
            console.log("🤖 CAPTCHA DETECTED:", element);
            
            // Show visual indicator
            this.showCaptchaOverlay();
            
            // Get click coordinates
            const coords = await this.getCaptchaClickCoordinates(element);
            
            if (coords) {
                console.log(`📍 Captcha click coordinates: (${coords.x}, ${coords.y})`);
                
                // Show tap indicator
                window.showTap(coords.x, coords.y);
                
                // Request hardware click
                const success = await this.hardwareBridge.sendClick(
                    coords.x,
                    coords.y,
                    'turnstile-checkbox',
                    coords.iframeOffset
                );
                
                if (success) {
                    console.log("✅ Hardware click request sent");
                    appendMsg("🤖 CAPTCHA detected - Hardware click triggered", false);
                } else {
                    console.error("❌ Failed to send hardware click request");
                    appendMsg("❌ CAPTCHA detected but click failed", false);
                }
            } else {
                console.error("Could not determine captcha click coordinates");
                appendMsg("⚠️ CAPTCHA detected but could not find click target", false);
            }
            
            // Hide overlay after a delay
            setTimeout(() => this.hideCaptchaOverlay(), 3000);
            
            this.isProcessing = false;
        }

        async getCaptchaClickCoordinates(element) {
            // Check if it's an iframe
            if (element.tagName === 'IFRAME') {
                return this.getIframeClickCoordinates(element);
            }
            
            // Direct element
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            
            return {
                x: x + window.scrollX,
                y: y + window.scrollY,
                iframeOffset: null
            };
        }

        async getIframeClickCoordinates(iframe) {
            const iframeRect = iframe.getBoundingClientRect();
            
            // Try to access iframe content (same-origin only)
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                
                // Find the clickable element inside iframe
                for (const selector of CONFIG.TURNSTILE_CLICK_SELECTORS) {
                    const clickTarget = iframeDoc.querySelector(selector);
                    if (clickTarget) {
                        const targetRect = clickTarget.getBoundingClientRect();
                        
                        // Calculate absolute screen position
                        const x = iframeRect.left + targetRect.left + targetRect.width / 2;
                        const y = iframeRect.top + targetRect.top + targetRect.height / 2;
                        
                        console.log(`Found click target inside iframe: ${selector}`);
                        
                        return {
                            x: x,
                            y: y,
                            iframeOffset: {
                                left: iframeRect.left,
                                top: iframeRect.top
                            }
                        };
                    }
                }
            } catch (e) {
                // Cross-origin iframe - can't access content
                console.log("Cross-origin iframe, using center coordinates");
            }
            
            // Fallback: click center of iframe
            return {
                x: iframeRect.left + iframeRect.width / 2,
                y: iframeRect.top + iframeRect.height / 2,
                iframeOffset: {
                    left: iframeRect.left,
                    top: iframeRect.top
                }
            };
        }

        showCaptchaOverlay() {
            let overlay = document.querySelector('.captcha-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'captcha-overlay';
                document.body.appendChild(overlay);
            }
        }

        hideCaptchaOverlay() {
            const overlay = document.querySelector('.captcha-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    }

    // ================================
    // TERMINAL BRIDGE (Existing Logic)
    // ================================
    window.terminalBridge = {
        status: "idle",
        responseText: "",
        
        async askCopilot(text, onChunk, onDone) {
            this.status = "busy";
            this.responseText = "";
            const originalFetch = window.fetch;
            
            function safeParse(str) {
                try {
                    if (typeof str === 'string' && str.endsWith('\x1e')) str = str.slice(0, -1);
                    return JSON.parse(str);
                } catch(e) { return null; }
            }

            let convId = null;
            try {
                const res = await originalFetch('https://copilot.microsoft.com/c/api/conversations', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' }
                });
                const data = await res.json();
                if (data && data.id) convId = data.id;
            } catch(e) {
                console.error("Failed to create conversation:", e);
            }

            if (!convId) {
                this.status = "idle";
                onDone("❌ Session Error. Please solve CAPTCHA if visible.");
                return;
            }

            const apiSocket = new WebSocket('wss://copilot.microsoft.com/c/api/chat?api-version=2');
            
            apiSocket.onopen = () => {
                apiSocket.send(JSON.stringify({
                    "event": "setOptions",
                    "supportedFeatures": ["partial-generated-images"]
                }));
                apiSocket.send(JSON.stringify({
                    "event": "send",
                    "conversationId": convId,
                    "content": [{"type": "text", "text": text}],
                    "mode": "smart"
                }));
            };
            
            apiSocket.onmessage = (event) => {
                const msg = safeParse(event.data);
                if (msg?.event === 'appendText') {
                    this.responseText += msg.text;
                    onChunk(this.responseText, msg.text);
                } else if (msg?.event === 'done' || msg?.event === 'error') {
                    apiSocket.close();
                    this.status = "idle";
                    onDone(this.responseText);
                }
            };
            
            apiSocket.onerror = (err) => {
                console.error("WebSocket error:", err);
                this.status = "idle";
                onDone("❌ Connection error");
            };
        }
    };

    // ================================
    // BACKEND WSS CONNECTION
    // ================================
    let backendSocket;
    
    function connectToBackend() {
        backendSocket = new WebSocket(CONFIG.BACKEND_WSS_URL);

        backendSocket.onopen = () => {
            console.log("🔌 Connected to Backend WSS");
            updateStatusDot('backend', true);
        };

        backendSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.message) {
                appendMsg(data.message, true);
                const aiMsgBox = appendMsg("...");

                window.terminalBridge.askCopilot(data.message, 
                    (fullText, chunk) => {
                        aiMsgBox.innerText = fullText;
                        chatArea.scrollTop = chatArea.scrollHeight;
                        backendSocket.send(JSON.stringify({
                            type: "chunk",
                            content: chunk,
                            full: fullText
                        }));
                    },
                    (finalText) => {
                        backendSocket.send(JSON.stringify({
                            type: "done",
                            content: finalText
                        }));
                    }
                );
            }
        };

        backendSocket.onclose = () => {
            console.log("❌ Backend WSS Closed. Retrying...");
            updateStatusDot('backend', false);
            setTimeout(connectToBackend, 3000);
        };
    }

    // ================================
    // UI CONSTRUCTION
    // ================================
    const ui = document.createElement('div');
    ui.id = 'copilot-ui-bridge';
    ui.innerHTML = `
        <div id="ui-header">
            <span>Copilot Bridge</span>
            <div>
                <span id="status-dot-backend" class="status-dot" title="Backend Connection"></span>
                <span id="status-dot-hardware" class="status-dot" title="Hardware Click Server"></span>
            </div>
        </div>
        <div id="chat-area"></div>
        <div id="input-box">
            <input type="text" id="user-prompt" placeholder="Message Copilot...">
            <button id="send-trigger">Send</button>
        </div>
    `;
    document.body.appendChild(ui);

    const chatArea = ui.querySelector('#chat-area');
    const inputField = ui.querySelector('#user-prompt');
    const sendBtnUI = ui.querySelector('#send-trigger');

    function appendMsg(content, isUser = false) {
        const div = document.createElement('div');
        div.className = `msg ${isUser ? 'user-msg' : 'ai-msg'}`;
        div.innerText = content;
        chatArea.appendChild(div);
        chatArea.scrollTop = chatArea.scrollHeight;
        return div;
    }

    function updateStatusDot(type, connected) {
        const dot = document.getElementById(`status-dot-${type}`);
        if (dot) {
            dot.classList.toggle('connected', connected);
        }
    }

    sendBtnUI.addEventListener('click', () => {
        const val = inputField.value.trim();
        if (!val || window.terminalBridge.status === "busy") return;
        
        const b = sendBtnUI.getBoundingClientRect();
        window.showTap(b.left + b.width/2, b.top + b.height/2);
        
        appendMsg(val, true);
        inputField.value = '';
        
        const aiMsgBox = appendMsg("...");
        window.terminalBridge.askCopilot(val, 
            (txt) => {
                aiMsgBox.innerText = txt;
                chatArea.scrollTop = chatArea.scrollHeight;
            },
            () => { console.log("Done."); }
        );
    });

    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendBtnUI.click();
    });

    // ================================
    // AUTO-INITIALIZATION (FIXED)
    // ================================
    async function autoInitialize() {
        console.log("🚀 Starting Auto-Initialization...");
        
        // Wait for input area
        let inputArea = null;
        for (let i = 0; i < 50; i++) {
            inputArea = document.querySelector('textarea[data-testid="composer-input"], textarea#userInput');
            if (inputArea) break;
            await sleep(500);
        }

        if (inputArea) {
            console.log("⌨️ Typing 'hi'...");
            
            // Visual indicator
            const rect = inputArea.getBoundingClientRect();
            window.showTap(rect.left + rect.width/2, rect.top + rect.height/2);
            
            // Focus
            inputArea.focus();
            
            // FIX: Use native value setter to trigger React/Vue bindings
            setNativeValue(inputArea, 'hi');
            
            await sleep(1500);
            
            const sendBtn = document.querySelector('button[data-testid="submit-button"]');
            if (sendBtn) {
                console.log("Clicking Send...");
                const sRect = sendBtn.getBoundingClientRect();
                window.showTap(sRect.left + sRect.width/2, sRect.top + sRect.height/2);
                sendBtn.click();
            }
        }

        await sleep(5000);
        
        // Check for existing captcha
        const turnstile = document.querySelector('#cf-turnstile, [id^="cf-chl-widget"]');
        if (turnstile) {
            console.log("🎯 Turnstile detected during init!");
        }
        
        console.log("✅ Auto-Init Sequence Finished.");
    }

    // ================================
    // MAIN STARTUP (FIXED ORDER)
    // ================================
    async function main() {
        // Initialize hardware click bridge
        const hardwareBridge = new HardwareClickBridge();
        
        // Start captcha detector
        const captchaDetector = new CaptchaDetector(hardwareBridge);
        
        // 1. Run Auto-Init immediately (Non-blocking)
        autoInitialize();
        
        // 2. Connect to backend immediately
        connectToBackend();
        
        // 3. Connect to hardware click server (Background)
        // We do not await this, so it doesn't block the script if the server is off
        hardwareBridge.connect()
            .then(() => {
                console.log("✅ Hardware Click Bridge ready");
                captchaDetector.start();
            })
            .catch(e => {
                console.warn("⚠️ Hardware Click Server not available:", e);
            });
        
        appendMsg("🚀 Copilot Bridge initialized with CAPTCHA support", false);
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();
