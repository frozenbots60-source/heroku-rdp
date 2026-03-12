(function() {
    // --- CONFIGURATION ---
    const BACKEND_WSS_URL = "wss://wss-api-5ca5596e4af3.herokuapp.com/ws";

    // --- 1. CSS STYLES (Visual Ripple + Floating UI) ---
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
        #status-dot { width: 10px; height: 10px; background: #ff4d4d; border-radius: 50%; display: inline-block; margin-left: 5px; }
    `;
    document.head.appendChild(style);

    // --- 2. UTILITIES ---
    window.showTap = function(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'ai-tap-ripple';
        ripple.style.left = x + 'px'; ripple.style.top = y + 'px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 800);
    };

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    // --- 3. TERMINAL BRIDGE (WebSocket Logic) ---
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
                    method: 'POST', headers: { 'Accept': 'application/json' }
                });
                const data = await res.json();
                if (data && data.id) convId = data.id;
            } catch(e) {}

            if (!convId) {
                this.status = "idle";
                onDone("❌ Session Error. Please solve CAPTCHA if visible.");
                return;
            }

            const apiSocket = new WebSocket('wss://copilot.microsoft.com/c/api/chat?api-version=2');
            apiSocket.onopen = () => {
                apiSocket.send(JSON.stringify({"event": "setOptions", "supportedFeatures": ["partial-generated-images"]}));
                apiSocket.send(JSON.stringify({"event": "send", "conversationId": convId, "content": [{"type": "text", "text": text}], "mode": "smart"}));
            };
            apiSocket.onmessage = (event) => {
                const msg = safeParse(event.data);
                if (msg?.event === 'appendText') {
                    this.responseText += msg.text;
                    onChunk(this.responseText, msg.text); // Pass full text and new chunk
                } else if (msg?.event === 'done' || msg?.event === 'error') {
                    apiSocket.close();
                    this.status = "idle";
                    onDone(this.responseText);
                }
            };
        }
    };

    // --- 4. BACKEND WSS CONNECTION ---
    let backendSocket;
    function connectToBackend() {
        backendSocket = new WebSocket(BACKEND_WSS_URL);
        const statusDot = document.getElementById('status-dot');

        backendSocket.onopen = () => {
            console.log("🔌 Connected to Backend WSS");
            if(statusDot) statusDot.style.background = "#00ff00";
        };

        backendSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.message) {
                // UI: Show user message coming from backend
                appendMsg(data.message, true);
                const aiMsgBox = appendMsg("...");

                // Execute Copilot logic
                window.terminalBridge.askCopilot(data.message, 
                    (fullText, chunk) => {
                        aiMsgBox.innerText = fullText;
                        chatArea.scrollTop = chatArea.scrollHeight;
                        // Stream chunk back to backend
                        backendSocket.send(JSON.stringify({ type: "chunk", content: chunk, full: fullText }));
                    },
                    (finalText) => {
                        backendSocket.send(JSON.stringify({ type: "done", content: finalText }));
                    }
                );
            }
        };

        backendSocket.onclose = () => {
            console.log("❌ Backend WSS Closed. Retrying...");
            if(statusDot) statusDot.style.background = "#ff4d4d";
            setTimeout(connectToBackend, 3000);
        };
    }

    // --- 5. AUTO-INITIALIZATION SEQUENCE (Python Port) ---
    async function autoInitialize() {
        console.log("🚀 Starting Auto-Initialization...");
        let inputArea = null;
        for(let i=0; i<50; i++) {
            inputArea = document.querySelector('textarea[data-testid="composer-input"], textarea#userInput');
            if(inputArea) break;
            await sleep(500);
        }

        if(inputArea) {
            console.log("⌨️ Typing 'hi'...");
            const rect = inputArea.getBoundingClientRect();
            window.showTap(rect.left + rect.width/2, rect.top + rect.height/2);
            inputArea.focus();
            inputArea.value = "hi";
            inputArea.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(1500);
            const sendBtn = document.querySelector('button[data-testid="submit-button"]');
            if(sendBtn) {
                console.log("Clicking Send...");
                const sRect = sendBtn.getBoundingClientRect();
                window.showTap(sRect.left + sRect.width/2, sRect.top + sRect.height/2);
                sendBtn.click();
            }
        }

        await sleep(5000);
        const turnstile = document.querySelector('#cf-turnstile, [id^="cf-chl-widget"]');
        if(turnstile) {
            console.log("🎯 Turnstile detected!");
            const tRect = turnstile.getBoundingClientRect();
            window.showTap(tRect.left + tRect.width/2, tRect.top + tRect.height/2);
            turnstile.click();
        }
        console.log("✅ Auto-Init Sequence Finished.");
    }

    // --- 6. UI CONSTRUCTION ---
    const ui = document.createElement('div');
    ui.id = 'copilot-ui-bridge';
    ui.innerHTML = `
        <div id="ui-header">
            <span>Copilot Bridge</span>
            <span id="status-dot" title="Backend Connection Status"></span>
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

    sendBtnUI.addEventListener('click', () => {
        const val = inputField.value.trim();
        if (!val || window.terminalBridge.status === "busy") return;
        const b = sendBtnUI.getBoundingClientRect();
        window.showTap(b.left + b.width/2, b.top + b.height/2);
        appendMsg(val, true);
        inputField.value = '';
        const aiMsgBox = appendMsg("...");
        window.terminalBridge.askCopilot(val, 
            (txt) => { aiMsgBox.innerText = txt; chatArea.scrollTop = chatArea.scrollHeight; },
            () => { console.log("Done."); }
        );
    });

    // Final Startup
    autoInitialize();
    connectToBackend();
    inputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') sendBtnUI.click(); });
})();
