// =============================================================================
// KUST CODE CLAIMER - LITE SERVER VERSION
// Lightweight headless version for low-end PCs and servers
// Works on Firefox, Node.js, and browsers without GUI
// Version: 3.0-lite
// =============================================================================

(function () {
    'use strict';

    // ================================
    // CONFIGURATION
    // ================================
    const CONFIG = {
        // WebSocket server URLs
        WS_SERVER_URL: 'wss://code-extract1-840a32439225.herokuapp.com/ws',
        AUTH_CHECK_URL: 'https://code-auth11-4cc0b14f630c.herokuapp.com/check',

        // Telegram notifications (optional)
        TG_BOT_TOKEN: '8068628711:AAEcw4c5oKw92bpYMI51L8_C8bOPNlN_BB0',
        TG_CHAT_ID: '7618467489',

        // Turnstile site key
        TURNSTILE_SITE_KEY: '0x4AAAAAAAGD4gMGOTFnvupz',

        // Backend reporting
        REPORTING_BACKEND_URL: 'https://code-dash-jp-ca7ff227dc68.herokuapp.com/api/claim-report',

        // Stake API endpoint (can be changed for different mirrors)
        STAKE_API_URL: 'https://stake.com/_api/graphql',

        // Session token (REQUIRED - set this before running)
        SESSION_TOKEN: '',

        // Default currency
        CURRENCY: 'usdt',

        // Token cache settings
        MAX_TOKEN_CACHE: 5,
        TOKEN_TIMEOUT: 2.6 * 60 * 1000, // 2.6 minutes

        // Reconnection delay
        RECONNECT_DELAY: 5000,

        // Retry settings
        MAX_RETRIES: 3,
        RETRY_DELAYS: [3000, 5000, 7000]
    };

    // ================================
    // STATE
    // ================================
    let webSocket = null;
    let currentUsername = null;
    let claimedCodes = new Set();
    let processingCodes = new Set();
    let claimStats = { success: 0, failed: 0, totalValue: 0 };

    // Token cache (simplified - just stores tokens with timestamps)
    let tokenCache = [];
    let isGeneratingToken = false;

    // ================================
    // LOGGING (Console Only)
    // ================================
    function log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const prefix = {
            'info': '[INFO]',
            'success': '[OK]',
            'error': '[ERR]',
            'warning': '[WARN]'
        }[type] || '[LOG]';
        console.log(`${time} ${prefix} ${msg}`);
    }

    // ================================
    // HTTP REQUESTS (Fetch-based)
    // ================================
    async function httpRequest(url, options = {}) {
        const method = options.method || 'GET';
        const headers = options.headers || {};
        const body = options.body || null;

        // Remove unsafe headers
        const unsafeHeaders = ['Referer', 'Origin', 'User-Agent', 'Content-Length', 'Host', 'Connection', 'Cookie'];
        unsafeHeaders.forEach(h => delete headers[h]);

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
                mode: 'cors'
            });
            const text = await response.text();
            try {
                return { data: JSON.parse(text), status: response.status };
            } catch {
                return { data: text, status: response.status };
            }
        } catch (error) {
            throw error;
        }
    }

    // ================================
    // TURNSTILE TOKEN MANAGEMENT (Simplified)
    // ================================
    async function generateTurnstileToken() {
        if (isGeneratingToken) return null;
        isGeneratingToken = true;

        return new Promise((resolve, reject) => {
            try {
                // Create hidden container for Turnstile
                let container = document.getElementById('turnstile-container');
                if (container) container.remove();

                container = document.createElement('div');
                container.id = 'turnstile-container';
                container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;overflow:hidden;';
                document.body.appendChild(container);

                if (typeof turnstile === 'undefined') {
                    // Load Turnstile script
                    const script = document.createElement('script');
                    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                    script.onload = () => renderTurnstile(container, resolve, reject);
                    script.onerror = () => {
                        isGeneratingToken = false;
                        reject(new Error('Failed to load Turnstile'));
                    };
                    document.head.appendChild(script);
                } else {
                    renderTurnstile(container, resolve, reject);
                }
            } catch (error) {
                isGeneratingToken = false;
                reject(error);
            }
        });
    }

    function renderTurnstile(container, resolve, reject) {
        try {
            const widgetId = turnstile.render(container, {
                sitekey: CONFIG.TURNSTILE_SITE_KEY,
                theme: 'dark',
                callback: (token) => {
                    isGeneratingToken = false;
                    cleanupTurnstile(widgetId);
                    resolve(token);
                },
                'error-callback': (error) => {
                    isGeneratingToken = false;
                    cleanupTurnstile(widgetId);
                    reject(error);
                },
                'timeout-callback': () => {
                    isGeneratingToken = false;
                    cleanupTurnstile(widgetId);
                    reject(new Error('Turnstile timeout'));
                }
            });
        } catch (error) {
            isGeneratingToken = false;
            reject(error);
        }
    }

    function cleanupTurnstile(widgetId) {
        try {
            if (widgetId !== null && typeof turnstile !== 'undefined') {
                turnstile.remove(widgetId);
            }
        } catch {}
        const container = document.getElementById('turnstile-container');
        if (container) container.remove();
    }

    function getFastToken() {
        const now = Date.now();
        // Clean expired tokens
        tokenCache = tokenCache.filter(t => now - t.timestamp < CONFIG.TOKEN_TIMEOUT);

        if (tokenCache.length > 0) {
            const tokenData = tokenCache.shift();
            // Refill cache in background
            refillTokenCache();
            return { token: tokenData.token, cacheHit: true };
        }
        return null;
    }

    async function refillTokenCache() {
        while (tokenCache.length < CONFIG.MAX_TOKEN_CACHE && !isGeneratingToken) {
            try {
                const token = await generateTurnstileToken();
                if (token) {
                    tokenCache.push({ token, timestamp: Date.now() });
                    log(`Token cached (${tokenCache.length}/${CONFIG.MAX_TOKEN_CACHE})`, 'info');
                }
            } catch (error) {
                log(`Token generation failed: ${error.message}`, 'warning');
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    async function getToken() {
        const fastToken = getFastToken();
        if (fastToken) return fastToken;

        // No cached token, generate one
        log('Token cache empty, generating...', 'warning');
        const token = await generateTurnstileToken();
        return { token, cacheHit: false };
    }

    // ================================
    // STAKE API
    // ================================
    async function claimBonusCode(code, token) {
        const payload = {
            operationName: 'ClaimConditionBonusCode',
            variables: {
                code: code,
                currency: CONFIG.CURRENCY,
                turnstileToken: token
            },
            query: `mutation ClaimConditionBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) {
                claimConditionBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) {
                    bonusCode { id code __typename }
                    amount currency
                    user { id balances { available { amount currency __typename } __typename } __typename }
                    __typename
                }
            }`
        };

        const headers = {
            'Content-Type': 'application/json',
            'x-access-token': CONFIG.SESSION_TOKEN,
            'x-operation-name': 'ClaimConditionBonusCode',
            'x-operation-type': 'query'
        };

        try {
            const startTime = performance.now();
            const result = await httpRequest(CONFIG.STAKE_API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            const latency = Math.round(performance.now() - startTime);

            if (result.data.errors) {
                return { success: false, error: result.data.errors[0].message, latency };
            }
            if (result.data.data && result.data.data.claimConditionBonusCode) {
                return { success: true, data: result.data.data.claimConditionBonusCode, latency };
            }
            return { success: false, error: 'Invalid response', latency };
        } catch (error) {
            return { success: false, error: error.message, latency: 0 };
        }
    }

    async function checkBonusCode(code) {
        const payload = {
            operationName: 'BonusCodeInformation',
            variables: { code: code, couponType: 'drop' },
            query: `query BonusCodeInformation($code: String!, $couponType: CouponType!) {
                bonusCodeInformation(code: $code, couponType: $couponType) {
                    availabilityStatus bonusValue cryptoMultiplier
                }
            }`
        };

        const headers = {
            'Content-Type': 'application/json',
            'x-access-token': CONFIG.SESSION_TOKEN,
            'x-operation-name': 'BonusCodeInformation',
            'x-operation-type': 'query'
        };

        try {
            const result = await httpRequest(CONFIG.STAKE_API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            if (result.data.data && result.data.data.bonusCodeInformation) {
                return { success: true, data: result.data.data.bonusCodeInformation };
            }
            return { success: false };
        } catch {
            return { success: false };
        }
    }

    // ================================
    // ERROR TYPE DETECTION
    // ================================
    function getErrorType(errorMessage) {
        const msg = (errorMessage || '').toLowerCase();

        if (msg.includes('bonuscodeinactive') || msg.includes('fully claimed') || msg.includes('inactive')) {
            return 'bonusCodeInactive';
        }
        if (msg.includes('weeklywagerrequirement') || msg.includes('wager requirement')) {
            return 'weeklyWagerRequirement';
        }
        if (msg.includes('alreadyclaimed') || msg.includes('already claimed') || msg.includes('already redeemed')) {
            return 'alreadyClaimed';
        }
        if (msg.includes('withdrawerror') || msg.includes('withdraw error')) {
            return 'withdrawError';
        }
        if (msg.includes('emailunverified') || msg.includes('email unverified')) {
            return 'emailUnverified';
        }
        if (msg.includes('kyclevelnotsufficient') || msg.includes('verification level')) {
            return 'kycLevelNotSufficient';
        }
        return 'unknown';
    }

    // ================================
    // REPORTING
    // ================================
    async function reportToBackend(reportData) {
        try {
            await httpRequest(CONFIG.REPORTING_BACKEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData)
            });
        } catch {}
    }

    // ================================
    // CODE PROCESSING
    // ================================
    async function processCode(code, retryCount = 0) {
        if (!code || processingCodes.has(code)) return;
        if (claimedCodes.has(code)) return;

        processingCodes.add(code);
        claimedCodes.add(code);

        const startTime = performance.now();
        log(`Processing: ${code}`, 'info');

        try {
            const tokenResult = await getToken();
            const token = tokenResult.token;

            if (!token) {
                log(`Failed to get token for ${code}`, 'error');
                processingCodes.delete(code);
                return;
            }

            const result = await claimBonusCode(code, token);

            if (result.success) {
                const data = result.data;
                claimStats.success++;
                claimStats.totalValue += parseFloat(data.amount) || 0;

                log(`CLAIMED ${code}: ${data.amount} ${data.currency} (${result.latency}ms)`, 'success');

                // Report to backend
                reportToBackend({
                    username: currentUsername,
                    code: code,
                    status: 'SUCCESS',
                    amount: data.amount,
                    currency: data.currency,
                    latency: result.latency,
                    cacheHit: tokenResult.cacheHit,
                    timestamp: new Date().toISOString()
                });

                processingCodes.delete(code);
                return;
            }

            // Handle errors
            const errorType = getErrorType(result.error);
            const nonRetryable = ['bonusCodeInactive', 'alreadyClaimed', 'weeklyWagerRequirement',
                                   'withdrawError', 'emailUnverified', 'kycLevelNotSufficient'];

            if (nonRetryable.includes(errorType)) {
                claimStats.failed++;
                log(`SKIP ${code}: ${errorType}`, 'warning');

                reportToBackend({
                    username: currentUsername,
                    code: code,
                    status: 'FAILED',
                    reason: errorType,
                    timestamp: new Date().toISOString()
                });

                processingCodes.delete(code);
                return;
            }

            // Retry logic
            if (retryCount < CONFIG.MAX_RETRIES) {
                log(`RETRY ${code} (${retryCount + 1}/${CONFIG.MAX_RETRIES})`, 'warning');
                await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAYS[retryCount]));
                processingCodes.delete(code);
                claimedCodes.delete(code);
                await processCode(code, retryCount + 1);
            } else {
                claimStats.failed++;
                log(`FAILED ${code}: ${result.error}`, 'error');

                reportToBackend({
                    username: currentUsername,
                    code: code,
                    status: 'FAILED',
                    error: result.error,
                    retries: CONFIG.MAX_RETRIES,
                    timestamp: new Date().toISOString()
                });

                processingCodes.delete(code);
            }

        } catch (error) {
            log(`ERROR ${code}: ${error.message}`, 'error');
            processingCodes.delete(code);
        }
    }

    // ================================
    // WEBSOCKET CONNECTION
    // ================================
    function connectWebSocket() {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) return;

        log('Connecting to WebSocket...', 'info');

        try {
            const wsUrl = `${CONFIG.WS_SERVER_URL}?user=${currentUsername || 'anonymous'}`;
            webSocket = new WebSocket(wsUrl);

            webSocket.onopen = () => {
                log('Connected to server', 'success');
                // Start token cache refill
                refillTokenCache();
            };

            webSocket.onmessage = (event) => {
                const raw = event.data;
                if (typeof raw !== 'string' || !raw.includes('"code"')) return;

                // Fast regex extraction
                const codeMatch = raw.match(/"code"\s*:\s*"([^"]+)"/);
                if (codeMatch && codeMatch[1]) {
                    processCode(codeMatch[1]);
                }
            };

            webSocket.onclose = () => {
                log('Disconnected, reconnecting...', 'warning');
                webSocket = null;
                setTimeout(connectWebSocket, CONFIG.RECONNECT_DELAY);
            };

            webSocket.onerror = (error) => {
                log('WebSocket error', 'error');
            };

        } catch (error) {
            log(`Connection failed: ${error.message}`, 'error');
            setTimeout(connectWebSocket, CONFIG.RECONNECT_DELAY);
        }
    }

    // ================================
    // AUTHORIZATION CHECK
    // ================================
    async function checkAuthorization(username) {
        if (!username) return false;

        try {
            const result = await httpRequest(`${CONFIG.AUTH_CHECK_URL}?user=@${username}`);
            if (result.data && result.data.exists === true) {
                return true;
            }
            return false;
        } catch {
            // Assume authorized on network error
            return true;
        }
    }

    // ================================
    // INITIALIZATION
    // ================================
    async function init() {
        log('=== KUST CLAIMER LITE v3.0 ===', 'info');
        log('Starting...', 'info');

        // Validate session token
        if (!CONFIG.SESSION_TOKEN) {
            log('ERROR: SESSION_TOKEN not set in CONFIG!', 'error');
            log('Please set your Stake session token before running.', 'error');
            return;
        }

        // Set username (you can modify this to extract from session)
        currentUsername = 'user'; // Set your username here

        // Check authorization
        const isAuthorized = await checkAuthorization(currentUsername);
        if (!isAuthorized) {
            log('Authorization failed. Check your subscription.', 'error');
            return;
        }

        log('Authorized. Connecting...', 'success');

        // Connect to WebSocket
        connectWebSocket();

        // Print stats periodically
        setInterval(() => {
            log(`Stats: ${claimStats.success} claimed, ${claimStats.failed} failed, $${claimStats.totalValue.toFixed(2)} total`, 'info');
        }, 60000); // Every minute
    }

    // ================================
    // ENTRY POINT
    // ================================
    // Check if running in browser or Node.js
    if (typeof window !== 'undefined') {
        // Browser environment
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    } else {
        // Node.js environment (would need WebSocket polyfill)
        log('Node.js environment detected.', 'info');
        log('Note: This script requires a browser environment with Turnstile support.', 'warning');
        // init(); // Uncomment if you have proper polyfills
    }

    // Export for manual control
    window.KustClaimer = {
        init,
        processCode,
        claimStats,
        CONFIG,
        setSession: (token) => { CONFIG.SESSION_TOKEN = token; },
        setUsername: (name) => { currentUsername = name; }
    };

})();
