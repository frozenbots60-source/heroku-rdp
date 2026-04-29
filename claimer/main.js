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
        BACKEND_WSS_URL: "wss://ai-wss-685eced2e7b5.herokuapp.com/ws",
        
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
                        resolve();
                    };
                    
                    this.ws.onclose = () => {
                        this.connected = false;
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
            
            // FIX: Wait 2-5 seconds to let the widget adjust and settle
            const waitTime = 2000 + Math.floor(Math.random() * 3000); // Random between 2s and 5s
            console.log(`⏳ Waiting ${waitTime}ms for CAPTCHA to settle...`);
            await sleep(waitTime);
            
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
                } else {
                    console.error("❌ Failed to send hardware click request");
                }
            } else {
                console.error("Could not determine captcha click coordinates");
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
    // TERMINAL BRIDGE (UPDATED API CALLS)
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
            
            // FIX 1: Try to extract conversation ID from URL first (e.g. /chats/xxxxxx)
            const urlMatch = window.location.pathname.match(/\/chats\/([a-zA-Z0-9_-]+)/);
            if (urlMatch && urlMatch[1]) {
                convId = urlMatch[1];
                console.log("📌 Using conversation from URL:", convId);
            }
            
            // FIX 2: Fallback - get from existing conversations list (new endpoint)
            if (!convId) {
                try {
                    const res = await originalFetch('https://copilot.microsoft.com/c/api/conversations?types=chat%2Ccharacter%2Cxbox%2Cgroup', {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' },
                        credentials: 'include'
                    });
                    const data = await res.json();
                    // Response shape may be { items: [...] } or an array
                    const items = (data && data.items) ? data.items : (Array.isArray(data) ? data : null);
                    if (items && items.length > 0 && items[0].id) {
                        convId = items[0].id;
                        console.log("📌 Using existing conversation:", convId);
                    }
                } catch(e) {
                    console.error("Failed to get conversations list:", e);
                }
            }
            
            // FIX 3: Final fallback - call /c/api/start to create a new session
            if (!convId) {
                try {
                    const res = await originalFetch('https://copilot.microsoft.com/c/api/start', {
                        method: 'POST',
                        headers: { 
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({})
                    });
                    const data = await res.json();
                    if (data) {
                        convId = data.id || data.conversationId || (data.conversation && data.conversation.id);
                    }
                    if (convId) console.log("📌 Started new conversation:", convId);
                } catch(e) {
                    console.error("Failed to start conversation:", e);
                }
            }

            if (!convId) {
                this.status = "idle";
                onDone("❌ Session Error. Please solve CAPTCHA if visible.");
                return;
            }

            const apiSocket = new WebSocket('wss://copilot.microsoft.com/c/api/chat?api-version=2');
            let assistantMessageId = null;  // Track which messageId belongs to assistant
            
            apiSocket.onopen = () => {
                // FIX 4: Updated setOptions with new supportedFeatures and supportedCards
                apiSocket.send(JSON.stringify({
                    "event": "setOptions",
                    "supportedFeatures": [
                        "partial-generated-images",
                        "side-by-side-comparison",
                        "session-duration-nudge",
                        "compose-email-html"
                    ],
                    "supportedCards": [
                        "weather", "local", "image", "sports", "video",
                        "healthcareEntity", "healthcareInfo", "chart",
                        "safetyHelpline", "quiz", "finance", "recipe", "personal"
                    ]
                }));
                
                // FIX 5: New event - report local consents (required by new API)
                apiSocket.send(JSON.stringify({
                    "event": "reportLocalConsents",
                    "grantedConsents": []
                }));
                
                // FIX 6: send event - mode is now lowercase "smart" and includes "context": {}
                apiSocket.send(JSON.stringify({
                    "event": "send",
                    "conversationId": convId,
                    "content": [{"type": "text", "text": text}],
                    "mode": "smart",
                    "context": {}
                }));
            };
            
            apiSocket.onmessage = (event) => {
                const msg = safeParse(event.data);
                if (!msg) return;
                
                // FIX 7: Track assistant's messageId from startMessage event
                // so we don't echo back our own user message text
                if (msg.event === 'startMessage') {
                    assistantMessageId = msg.messageId;
                    console.log("🤖 Assistant message started:", assistantMessageId);
                } else if (msg.event === 'appendText') {
                    // Only append text from the assistant, not user echo
                    if (!assistantMessageId || msg.messageId === assistantMessageId) {
                        this.responseText += msg.text;
                        onChunk(this.responseText, msg.text);
                    }
                } else if (msg.event === 'done' || msg.event === 'error') {
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
            
            apiSocket.onclose = () => {
                if (this.status === "busy") {
                    this.status = "idle";
                    if (this.responseText) {
                        onDone(this.responseText);
                    }
                }
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
        };

        backendSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.message) {
                console.log("Received message from backend:", data.message);
                
                window.terminalBridge.askCopilot(data.message, 
                    (fullText, chunk) => {
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
            setTimeout(connectToBackend, 3000);
        };
    }

    // ================================
    // AUTO-INITIALIZATION (FIXED)
    // ================================
    async function autoInitialize() {
        console.log("🚀 Starting Auto-Initialization...");
        
        // FIX: Wait for page to load initially (3 seconds)
        console.log("⏳ Waiting for page to load...");
        await sleep(3000);
        
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
            
            // Wait a second after typing
            await sleep(1000);
            
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
        
        console.log("🚀 Copilot Bridge initialized with CAPTCHA support");
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();
