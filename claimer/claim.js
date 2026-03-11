// =============================================================================
// CHROME EXTENSION COMPATIBILITY LAYER
// These shims allow the Tampermonkey script to run natively in Chrome (MV3)
// =============================================================================

const unsafeWindow = window;
const GM_addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
};
const GM_getValue = (key, defaultValue) => {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue;
    try {
        return JSON.parse(value);
    } catch (e) {
        return value;
    }
};
const GM_setValue = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
};
const GM_xmlhttpRequest = (details) => {
    const { method, url, headers, data, onload, onerror } = details;
    // Filter out headers that cause "Refused to set unsafe header" errors in Chrome
    // This prevents the debugger from pausing on exceptions.
    const safeHeaders = headers ? { ...headers } : {};
    
    const unsafeHeaders = ['Referer', 'Origin', 'User-Agent', 'Content-Length', 'Host', 'Connection', 'Cookie'];
    unsafeHeaders.forEach(header => delete safeHeaders[header]);
    
    fetch(url, {
        method: method || 'GET',
        headers: safeHeaders,
        body: data,
        mode: 'cors'
    })
    .then(async response => {
        const text = await response.text();
        if (onload) {
            onload({
                responseText: text,
                status: response.status,
                statusText: response.statusText,
                readyState: 4
            });
        }
    })
    .catch(error => {
        if (onerror) {
            onerror(error);
        }
    });
};

// =============================================================================
// HARDCODED SESSION TOKEN CONFIGURATION
// =============================================================================
// Set your session token here or via environment variable
// Priority: HARDCODED_SESSION_TOKEN > localStorage > Cookie
// To use: Set the token value below or set localStorage.setItem('HARDCODED_SESSION_TOKEN', 'your_token_here')
const HARDCODED_SESSION_TOKEN = '47018fa022230ff6f25634b58ba416abf173596ba826d1aeba6a0d575cc174fe91c80d7c31f7f566ba0c85c6375f644f'; // <-- PASTE YOUR SESSION TOKEN HERE (leave empty to use cookie)

// Helper function to get hardcoded token from various sources
function getHardcodedSessionToken() {
    // 1. Check direct hardcoded value first
    if (HARDCODED_SESSION_TOKEN && HARDCODED_SESSION_TOKEN.trim() !== '') {
        return HARDCODED_SESSION_TOKEN.trim();
    }
    
    // 2. Check localStorage for hardcoded token (can be set externally)
    const localStorageToken = localStorage.getItem('HARDCODED_SESSION_TOKEN');
    if (localStorageToken && localStorageToken.trim() !== '') {
        return localStorageToken.trim();
    }
    
    // 3. Check for environment variable style (window.__KUST_SESSION_TOKEN__)
    if (typeof window !== 'undefined' && window.__KUST_SESSION_TOKEN__) {
        return window.__KUST_SESSION_TOKEN__;
    }
    
    // No hardcoded token found
    return null;
}
// =============================================================================

// =============================================================================
// ORIGINAL SCRIPT STARTS HERE
// =============================================================================

// ==UserScript==
// @name         kust-code-claimer
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Premium WebSocket listener & Auto Bonus Claimer for Stake.com (Dual Server Support) - Raw JSON Reporting
// @author       Kust
// @match        *://*stake*/settings/offers*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      stake.com
// @connect      stake*.com
// @connect      stake*.in
// @connect      stake*.pet
// @connect      backend.tenopno.workers.dev
// @connect      kust-bots-129c234bbe49.herokuapp.com
// @connect      chat-auth-75bd02aa400a.herokuapp.com
// @connect      velocity.kustbotsweb.workers.dev
// @connect      code.hh123.site
// @connect      cdn.socket.io
// @connect      api.telegram.org
// @connect      code-dash-ba59fe89410e.herokuapp.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    // ================================
    // ⚙️ CONFIGURATION
    // ================================
    
    // --- DYNAMIC CONFIG START ---
    const REMOTE_CONFIG_URL = 'https://velocity.kustbotsweb.workers.dev/';
    
    // Default fallbacks (Old hardcoded values) in case remote fetch fails
    let WS_SERVER_URL = 'wss://code-extract1-840a32439225.herokuapp.com/ws';
    let AUTH_CHECK_URL = 'https://code-auth11-4cc0b14f630c.herokuapp.com/check'; 
    // --- DYNAMIC CONFIG END ---

    // --- REGIONAL SERVER (HH123) CONFIG ---
    let HH123_URL = 'https://velocity.kustbotsweb.workers.dev';
    const HH123_USERNAME = 'Kustx';
    const HH123_VERSION = '6.3.0';
    let hh123Socket = null;
    // --------------------------------------

    const TG_BOT_TOKEN = '8068628711:AAEcw4c5oKw92bpYMI51L8_C8bOPNlN_BB0';
    const TG_CHAT_ID = '7618467489';
    const TURNSTILE_SITE_KEY = '0x4AAAAAAAGD4gMGOTFnvupz';
    
    // 🔧 CUSTOM BACKEND REPORTING URL - Raw JSON reports sent here
    const REPORTING_BACKEND_URL = 'https://code-dash-jp-ca7ff227dc68.herokuapp.com/api/claim-report';
    
    // 🌍 DYNAMIC MIRROR EXTRACTION
    // Extracts the exact origin (e.g., https://stake.com, https://stake.ac, https://stake.bet)
    const CURRENT_MIRROR = window.location.origin;
    const STAKE_API_URL = `${CURRENT_MIRROR}/_api/graphql`;
    const FC_USER_SETTINGS = 'FC_USER_SETTINGS';

    let webSocket = null;
    // Global reference for connection management
    let currentUsername = null;
    // Store username for periodic checks
    let currentSession = null;
    // Store session token
    let stakeApi = null;
    // API handler instance
    let isProcessing = true;
    
    // 🚀 GOD TIER OPTIMIZATION: Set instead of Array for O(1) lookups
    let claimedCodes = new Set();
    
    // Track codes currently being processed (to prevent duplicate processing)
    let processingCodes = new Set();
    
    let rates = {};
    // Currency conversion rates
    let selectedCurrency = 'usdt';
    // Default currency
    let userSettings = null; // User preferences
    let consecutiveAuthFailures = 0;
    // Track consecutive authorization failures
    let authCheckInProgress = false;
    // Prevent multiple simultaneous auth checks

    // 🚀 GOD TIER OPTIMIZATION: Pre-allocated Header object
    let OPTIMIZED_HEADERS = null;

    // Log entry counter for unique IDs
    let logEntryCounter = 0;

    // Network Stats Globals (Main Server)
    let netStats = {
        ping: 0,
        jitter: 0,
        packetLoss: 0,
        history: [],
        lastCheck: 0
    };

    // Network Stats Globals (Regional Server)
    let netStatsReg = {
        ping: 0,
        jitter: 0,
        packetLoss: 0,
        history: [],
        lastCheck: 0
    };

    // ================================
    // 📊 CLAIM STATISTICS TRACKER
    // ================================
    let claimStats = {
        successCount: 0,
        failedCount: 0,
        totalClaimedValue: 0,
        recentClaims: [] // Store last 50 claims for reporting
    };

    // ================================
    // 🎨 PREMIUM UI STYLES
    // ================================
    GM_addStyle(`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600;800&display=swap');

        :root {
            --kust-bg: rgba(12, 12, 14, 0.95);
            --kust-border: rgba(255, 255, 255, 0.1);
            --kust-accent: #00E701; /* Stake Green */
            --kust-accent-glow: rgba(0, 231, 1, 0.3);
            --kust-text: #E0E0E0;
            --kust-text-dim: #858585;
            --kust-success: #00E701;
            --kust-error: #FF4D4D;
            --kust-warning: #FFC107;
            --kust-header-bg: rgba(255, 255, 255, 0.03);
            --kust-settings-bg: rgba(20, 20, 24, 0.98);
        }

        #kust-panel {
            position: fixed !important;
            top: 50px; /* Movable */
            right: 50px; /* Movable */
            width: 380px !important;
            height: 520px !important;
            background: var(--kust-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--kust-border);
            border-radius: 16px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05);
            z-index: 2147483647 !important;
            /* Max Z-Index */
            display: flex !important;
            flex-direction: column;
            font-family: 'Inter', sans-serif;
            color: var(--kust-text);
            overflow: hidden;
            transition: opacity 0.3s ease;
            user-select: none;
            opacity: 1 !important;
        }

        /* 3D FLOATING TOKEN OVERLAY */
        #kust-token-overlay {
            position: fixed;
            left: -5px;
            bottom: 40px;
            /* Fixed blurriness with translateZ and font smoothing */
            transform: perspective(800px) rotateY(15deg) translateZ(0); 
            transform-origin: left center;
            background: linear-gradient(135deg, rgba(20, 20, 24, 0.95) 0%, rgba(10, 10, 12, 0.98) 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-left: 4px solid var(--kust-accent);
            padding: 16px 24px;
            border-radius: 0 16px 16px 0;
            box-shadow: 20px 20px 40px rgba(0, 0, 0, 0.8), 
                        inset 2px 2px 10px rgba(255, 255, 255, 0.05),
                        5px 0 15px rgba(0, 231, 1, 0.1);
            display: flex;
            align-items: center;
            gap: 16px;
            z-index: 2147483646;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            font-family: 'Inter', sans-serif;
            color: white;
            user-select: none;
            cursor: help;
            
            /* Anti-aliasing for clear text */
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            backface-visibility: hidden;
        }

        #kust-token-overlay:hover {
            transform: perspective(800px) rotateY(0deg) scale(1.02) translateZ(0);
            left: 0px;
            box-shadow: 25px 25px 50px rgba(0, 0, 0, 0.9), 
                        inset 2px 2px 10px rgba(255, 255, 255, 0.1),
                        10px 0 25px rgba(0, 231, 1, 0.2);
            border-left-width: 6px;
        }

        .token-3d-icon {
            font-size: 28px;
            filter: drop-shadow(0 0 10px rgba(0, 231, 1, 0.5));
            animation: float-icon 3s ease-in-out infinite;
            -webkit-font-smoothing: antialiased;
        }

        .token-3d-text {
            display: flex;
            flex-direction: column;
        }

        .token-3d-label {
            font-size: 10px;
            font-weight: 800;
            color: var(--kust-text-dim);
            letter-spacing: 1.5px;
            text-transform: uppercase;
            -webkit-font-smoothing: antialiased;
        }

        .token-3d-value {
            font-size: 24px;
            font-weight: 800;
            color: var(--kust-accent);
            font-family: 'JetBrains Mono', monospace;
            text-shadow: 0 0 15px rgba(0, 231, 1, 0.4);
            letter-spacing: -1px;
            transition: all 0.3s ease;
            -webkit-font-smoothing: antialiased;
        }

        /* Overlay States */
        #kust-token-overlay.charging .token-3d-icon {
            animation: pulse-spin 1.5s linear infinite;
        }
        
        #kust-token-overlay.charging .token-3d-value {
            color: var(--kust-warning);
            text-shadow: 0 0 15px rgba(255, 193, 7, 0.4);
        }
        #kust-token-overlay.charging {
            border-left-color: var(--kust-warning);
        }

        #kust-token-overlay.depleted .token-3d-icon {
            filter: grayscale(1) opacity(0.5);
            animation: none;
        }
        
        #kust-token-overlay.depleted .token-3d-value {
            color: var(--kust-error);
            text-shadow: 0 0 15px rgba(255, 77, 77, 0.4);
        }
        #kust-token-overlay.depleted {
            border-left-color: var(--kust-error);
        }

        @keyframes float-icon {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
        }

        @keyframes pulse-spin {
            0% { transform: scale(1) rotate(0deg); opacity: 1; }
            50% { transform: scale(1.2) rotate(180deg); opacity: 0.7; }
            100% { transform: scale(1) rotate(360deg); opacity: 1; }
        }

        /* HEADER */
        .kust-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: var(--kust-header-bg);
            border-bottom: 1px solid var(--kust-border);
            cursor: grab;
        }

        .kust-header:active {
            cursor: grabbing;
        }

        .kust-header-left {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .kust-title {
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .kust-title::before {
            content: '';
            display: block;
            width: 8px;
            height: 8px;
            background: var(--kust-accent);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--kust-accent);
        }

        .kust-username {
            font-size: 11px;
            color: var(--kust-text-dim);
            font-family: 'JetBrains Mono', monospace;
            margin-left: 16px; /* Align with text start */
        }
        .kust-username.active {
            color: var(--kust-accent);
        }

        .kust-header-right {
            display: flex;
            align-items: center;
        }
        
        /* NETWORK BARS */
        .network-bars {
            display: flex;
            align-items: flex-end;
            gap: 3px;
            height: 16px;
            margin-right: 15px;
            padding-bottom: 2px;
            opacity: 0.8;
            cursor: help;
        }
        
        .net-bar {
            width: 3px;
            border-radius: 2px;
            background: rgba(255,255,255,0.15);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .net-bar:nth-child(1) { height: 6px; }
        .net-bar:nth-child(2) { height: 10px; }
        .net-bar:nth-child(3) { height: 14px; }
        
        /* Network Quality States */
        .net-good .net-bar {
            background: var(--kust-accent);
            box-shadow: 0 0 6px var(--kust-accent);
        }
        
        .net-med .net-bar:nth-child(1),
        .net-med .net-bar:nth-child(2) {
            background: var(--kust-warning);
            box-shadow: 0 0 6px var(--kust-warning);
        }
        .net-med .net-bar:nth-child(3) {
            background: rgba(255,255,255,0.1);
            box-shadow: none;
        }
        
        .net-bad .net-bar:nth-child(1) {
            background: var(--kust-error);
            box-shadow: 0 0 6px var(--kust-error);
        }
        .net-bad .net-bar:nth-child(2),
        .net-bad .net-bar:nth-child(3) {
            background: rgba(255,255,255,0.1);
            box-shadow: none;
        }

        /* STATUS BADGE */
        .kust-status {
            font-size: 11px;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s ease;
        }

        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #666;
        }

        .kust-status.connected {
            border-color: rgba(0, 231, 1, 0.2);
            color: var(--kust-accent);
            background: rgba(0, 231, 1, 0.05);
        }
        .kust-status.connected .status-dot {
            background: var(--kust-accent);
            box-shadow: 0 0 8px var(--kust-accent);
            animation: pulse 2s infinite;
        }

        .kust-status.disconnected {
            border-color: rgba(255, 77, 77, 0.2);
            color: var(--kust-error);
            background: rgba(255, 77, 77, 0.05);
        }
        .kust-status.disconnected .status-dot {
            background: var(--kust-error);
        }

        /* LOGS CONTAINER */
        .kust-body {
            flex: 1;
            padding: 16px;
            overflow-y: hidden;
            position: relative;
            display: flex;
            flex-direction: column;
        }

        #kust-logs {
            flex: 1;
            overflow-y: auto;
            padding-right: 4px;
            scroll-behavior: smooth;
        }

        /* SCROLLBAR */
        #kust-logs::-webkit-scrollbar { width: 4px; }
        #kust-logs::-webkit-scrollbar-track { background: transparent; }
        #kust-logs::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
        #kust-logs::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.4); }

        /* LOG ENTRY */
        .log-entry {
            margin-bottom: 10px;
            padding: 12px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid transparent;
            font-size: 12px;
            line-height: 1.5;
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            transition: transform 0.2s;
        }

        .log-entry:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 10px;
            color: var(--kust-text-dim);
            font-family: 'JetBrains Mono', monospace;
        }

        .log-content {
            font-weight: 500;
            word-break: break-all;
        }

        /* LOG VARIANTS */
        .log-info { border-left: 3px solid #3b82f6; }
        .log-success {
            border-left: 3px solid var(--kust-success);
            background: linear-gradient(90deg, rgba(0, 231, 1, 0.05) 0%, transparent 100%);
        }
        .log-error {
            border-left: 3px solid var(--kust-error);
            background: linear-gradient(90deg, rgba(255, 77, 77, 0.05) 0%, transparent 100%);
        }
        .log-warning { border-left: 3px solid var(--kust-warning); }

        .code-highlight {
            font-family: 'JetBrains Mono', monospace;
            color: var(--kust-accent);
            background: rgba(0, 231, 1, 0.1);
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
        }

        .value-highlight {
            color: #FFD700;
            font-weight: bold;
        }

        .retry-highlight {
            color: var(--kust-warning);
            font-weight: bold;
        }

        /* LATENCY BREAKDOWN STYLES */
        .latency-breakdown {
            font-size: 10px;
            color: var(--kust-text-dim);
            margin-top: 6px;
            font-family: 'JetBrains Mono', monospace;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 6px;
        }

        .latency-item {
            display: inline-block;
            margin-right: 6px;
            margin-bottom: 2px;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.05);
        }

        .latency-network { color: #3b82f6; }
        .latency-turnstile { color: #a855f7; }
        .latency-api { color: #10b981; }
        .latency-total { color: #FFD700; font-weight: bold; }
        .latency-cache-hit { color: #00E701; background: rgba(0, 231, 1, 0.1); }
        .latency-cache-miss { color: #FFC107; background: rgba(255, 193, 7, 0.1); }

        /* ANIMATIONS */
        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        /* SETTINGS BUTTON */
        .kust-settings-btn {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
            margin-right: 10px;
        }

        .kust-settings-btn:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: rotate(90deg);
        }

        .kust-settings-btn svg {
            width: 14px;
            height: 14px;
            fill: var(--kust-text);
        }

        /* SETTINGS POPUP MODAL */
        #kust-settings-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 2147483648;
            display: none;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
        }

        #kust-settings-modal.open {
            display: flex;
        }

        .kust-settings-popup {
            width: 500px;
            max-height: 85vh;
            background: var(--kust-settings-bg);
            border-radius: 16px;
            border: 1px solid var(--kust-border);
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .settings-popup-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--kust-border);
        }

        .settings-popup-title {
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #fff;
        }

        .settings-popup-close {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: rgba(255, 77, 77, 0.1);
            border: 1px solid rgba(255, 77, 77, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
        }

        .settings-popup-close:hover {
            background: rgba(255, 77, 77, 0.2);
            transform: scale(1.1);
        }

        .settings-popup-close svg {
            width: 16px;
            height: 16px;
            fill: var(--kust-text);
        }

        .settings-popup-content {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }

        .settings-section {
            margin-bottom: 25px;
        }

        .settings-section-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--kust-accent);
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .settings-option {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            padding: 12px 15px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
            transition: all 0.2s;
        }

        .settings-option:hover {
            background: rgba(255, 255, 255, 0.08);
            transform: translateY(-2px);
        }

        .settings-checkbox {
            width: 20px;
            height: 20px;
            appearance: none;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 5px;
            margin-right: 15px;
            position: relative;
            cursor: pointer;
            transition: all 0.2s;
        }

        .settings-checkbox:checked {
            background: var(--kust-accent);
            border-color: var(--kust-accent);
        }

        .settings-checkbox:checked::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 6px;
            width: 6px;
            height: 12px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }

        .settings-label {
            flex: 1;
            font-size: 14px;
            color: var(--kust-text);
            cursor: pointer;
        }

        .settings-select {
            width: 100%;
            padding: 12px 15px;
            background: rgba(255, 255, 255, 0.05);
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            color: var(--kust-text);
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            margin-top: 10px;
            transition: all 0.2s;
        }

        .settings-select:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.2);
        }

        .settings-select:focus {
            outline: none;
            border-color: var(--kust-accent);
            box-shadow: 0 0 0 3px rgba(0, 231, 1, 0.2);
        }

        /* Fixed dropdown options styling */
        .settings-select option {
            background: #1a1a1a;
            color: var(--kust-text);
            padding: 8px;
        }
        
        /* NEW: Network Stats Grid in Settings */
        .net-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 10px;
        }
        
        .net-stat-item {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        
        .net-stat-label {
            font-size: 10px;
            color: var(--kust-text-dim);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
        }
        
        .net-stat-value {
            font-size: 14px;
            font-weight: 800;
            color: #fff;
            font-family: 'JetBrains Mono', monospace;
        }
        
        .stat-good { color: var(--kust-success) !important; }
        .stat-warn { color: var(--kust-warning) !important; }
        .stat-bad { color: var(--kust-error) !important; }

        /* CLAIM STATS DISPLAY */
        .claim-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 10px;
        }

        .claim-stat-item {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 10px;
            text-align: center;
        }

        .claim-stat-label {
            font-size: 9px;
            color: var(--kust-text-dim);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .claim-stat-value {
            font-size: 18px;
            font-weight: 800;
            font-family: 'JetBrains Mono', monospace;
        }

        .claim-stat-value.success { color: var(--kust-success); }
        .claim-stat-value.failed { color: var(--kust-error); }

        /* LOADING ANIMATION */
        .loading-container {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .loading {
            width: 60px;
            height: 10px;
            background-color: #2f4553;
            border-radius: 5px;
            position: relative;
            overflow: hidden;
        }

        .loading-animation {
            position: absolute;
            top: 2px;
            left: 2px;
            right: 2px;
            bottom: 2px;
            background-color: #a1c8f3;
            border-radius: 3px;
            animation: loading 1.5s infinite ease-in-out;
        }

        @keyframes loading {
            0% { left: 2px; width: 10px; }
            50% { left: 48px; width: 10px; }
            100% { left: 2px; width: 10px; }
        }

        /* SESSION TOKEN INDICATOR */
        .session-source-indicator {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            margin-left: 8px;
        }
        .session-source-hardcoded {
            background: rgba(0, 231, 1, 0.2);
            color: var(--kust-accent);
        }
        .session-source-cookie {
            background: rgba(255, 255, 255, 0.1);
            color: var(--kust-text-dim);
        }
    `);
    // ================================
    // 🛠️ UTILITIES
    // ================================
    function getCookie(name) {
        const cookie = `; ${document.cookie}`;
        const parts = cookie.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(";").shift();
        return null;
    }

    function formatTime() {
        const now = new Date();
        return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // ================================
    // 📝 LOGGING SYSTEM (With Edit Support)
    // ================================
    function addLog(msg, type = 'info', isCode = false, customId = null, latencyInfo = null) {
        const logContainer = document.getElementById("kust-logs");
        // Only add log if log container still exists
        if (!logContainer) return null;
        
        const entryId = customId || `log-${++logEntryCounter}`;
        
        // Check if we're updating an existing entry
        let entry = document.getElementById(entryId);
        const isNew = !entry;
        
        if (isNew) {
            entry = document.createElement("div");
            entry.id = entryId;
            entry.className = `log-entry log-${type}`;
        }
        
        const contentHtml = isCode
            ? msg.replace(/([A-Za-z0-9_-]+)/, '<span class="code-highlight">$1</span>')
            : msg;
        
        // Build latency breakdown HTML if provided
        // NOTE: "Network" now shows the actual API network latency (round-trip time to Stake API)
        let latencyHtml = '';
        if (latencyInfo) {
            latencyHtml = `
                <div class="latency-breakdown">
                    <span class="latency-item latency-network" title="Network latency (Round-trip to Stake API)">🌐 Network: ${latencyInfo.apiLatency}ms</span>
                    <span class="latency-item ${latencyInfo.turnstileCacheHit ? 'latency-cache-hit' : 'latency-cache-miss'}" title="Token retrieval (cache or generate)">
                        ${latencyInfo.turnstileCacheHit ? '⚡ Cache Hit' : '🔄 Cache Miss'} (${latencyInfo.tokenLatency}ms)
                    </span>
                    <span class="latency-item latency-total" title="Total processing time">⏱️ Total: ${latencyInfo.totalTime}ms</span>
                </div>
            `;
        }
            
        entry.innerHTML = `
            <div class="log-header">
                <span>${formatTime()}</span>
                <span style="opacity:0.7">${type.toUpperCase()}</span>
            </div>
            <div class="log-content">${contentHtml}</div>
            ${latencyHtml}
        `;
        
        if (isNew) {
            logContainer.appendChild(entry);
            // Auto-scroll logic
            if (logContainer.children.length > 50) {
                logContainer.removeChild(logContainer.firstChild);
            }
        }
        
        logContainer.scrollTop = logContainer.scrollHeight;
        return entryId;
    }

    function updateLog(entryId, msg, type = 'info', isCode = false, latencyInfo = null) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        // Update the class
        entry.className = `log-entry log-${type}`;
        
        const contentHtml = isCode
            ? msg.replace(/([A-Za-z0-9_-]+)/, '<span class="code-highlight">$1</span>')
            : msg;
        
        // Build latency breakdown HTML if provided
        // NOTE: "Network" now shows the actual API network latency (round-trip time to Stake API)
        let latencyHtml = '';
        if (latencyInfo) {
            latencyHtml = `
                <div class="latency-breakdown">
                    <span class="latency-item latency-network" title="Network latency (Round-trip to Stake API)">🌐 Network: ${latencyInfo.apiLatency}ms</span>
                    <span class="latency-item ${latencyInfo.turnstileCacheHit ? 'latency-cache-hit' : 'latency-cache-miss'}" title="Token retrieval (cache or generate)">
                        ${latencyInfo.turnstileCacheHit ? '⚡ Cache Hit' : '🔄 Cache Miss'} (${latencyInfo.tokenLatency}ms)
                    </span>
                    <span class="latency-item latency-total" title="Total processing time">⏱️ Total: ${latencyInfo.totalTime}ms</span>
                </div>
            `;
        }
            
        // Update time and content
        entry.innerHTML = `
            <div class="log-header">
                <span>${formatTime()}</span>
                <span style="opacity:0.7">${type.toUpperCase()}</span>
            </div>
            <div class="log-content">${contentHtml}</div>
            ${latencyHtml}
        `;
    }

    function updateStatus(status, text) {
        const statusEl = document.getElementById("kust-status-badge");
        const textEl = document.getElementById("kust-status-text");

        if (statusEl && textEl) {
            statusEl.className = `kust-status ${status}`;
            textEl.innerText = text;
        }
    }
    
    // ================================
    // 📊 AGGRESSIVE WSS LATENCY CHECK (MAIN SERVER)
    // ================================
    function activePingCheck() {
        // Wait for user to be initialized before pinging (requires auth param)
        // Also wait for WS_SERVER_URL to be populated
        if (!currentUsername || !WS_SERVER_URL) return;
        
        const start = performance.now();
        // Use a dummy user param to avoid interfering with main session, or use current user
        // Using random ping_check ID to keep it separate from main logic
        const pingUser = "ping_check_" + Math.floor(Math.random() * 1000);
        const wsUrl = `${WS_SERVER_URL}?user=${pingUser}`;
        
        try {
            // OPEN A REAL WEBSOCKET CONNECTION
            const tempWs = new WebSocket(wsUrl);
            // Timeout failsafe (Fixed 100% loss issue by increasing to 5000ms for slow handshakes)
            const timeout = setTimeout(() => {
                if(tempWs.readyState !== WebSocket.OPEN) {
                    tempWs.close();
                    handlePingResult(null, true); // Timeout = Packet Loss
                }
            }, 5000);
            tempWs.onopen = () => {
                clearTimeout(timeout);
                const end = performance.now();
                tempWs.close(); // Close immediately after handshake
                
                // DIVIDE BY 2 (One-Way Latency)
                const fullRtt = end - start;
                const latency = Math.round(fullRtt / 2);
                
                handlePingResult(latency, false);
            };

            tempWs.onerror = () => {
                clearTimeout(timeout);
                handlePingResult(null, true); // Error = Packet Loss
            };
        } catch (e) {
            handlePingResult(null, true);
        }
    }
    
    function handlePingResult(latency, isError) {
        if (isError) {
             // Less aggressive penalty (10%) to prevent false 100% spikes
             netStats.packetLoss = Math.min(100, netStats.packetLoss + 10);
        } else {
            // Success
            netStats.history.push(latency);
            if(netStats.history.length > 20) netStats.history.shift();
            
            // Calculate Jitter
            const subset = netStats.history.slice(-10);
            if (subset.length > 1) {
                const mean = subset.reduce((a, b) => a + b, 0) / subset.length;
                const variance = subset.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / subset.length;
                netStats.jitter = Math.round(Math.sqrt(variance));
            }
            
            // Packet Loss Decay (Recover faster)
            netStats.packetLoss = Math.max(0, netStats.packetLoss - 10);
            netStats.ping = latency;
        }
        updateNetworkUI();
    }

    // ================================
    // 📊 AGGRESSIVE LATENCY CHECK (REGIONAL HH123 SERVER)
    // ================================
    function activeRegionalPingCheck() {
        const start = performance.now();
        // Ping via HTTP Request to Engine.IO endpoint to measure latency
        GM_xmlhttpRequest({
            method: "GET",
            url: `${HH123_URL}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
            timeout: 5000,
            onload: () => {
                const end = performance.now();
                const latency = Math.round((end - start) / 2);
                handleRegionalPingResult(latency, false);
            },
            onerror: () => handleRegionalPingResult(null, true),
            ontimeout: () => handleRegionalPingResult(null, true)
        });
    }

    function handleRegionalPingResult(latency, isError) {
        if (isError) {
             netStatsReg.packetLoss = Math.min(100, netStatsReg.packetLoss + 10);
        } else {
            netStatsReg.history.push(latency);
            if(netStatsReg.history.length > 20) netStatsReg.history.shift();
            
            const subset = netStatsReg.history.slice(-10);
            if (subset.length > 1) {
                const mean = subset.reduce((a, b) => a + b, 0) / subset.length;
                const variance = subset.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / subset.length;
                netStatsReg.jitter = Math.round(Math.sqrt(variance));
            }
            
            netStatsReg.packetLoss = Math.max(0, netStatsReg.packetLoss - 10);
            netStatsReg.ping = latency;
        }
        
        // If Settings Modal is open, update live stats there too
        const settingsModal = document.getElementById('kust-settings-modal');
        if (settingsModal && settingsModal.classList.contains('open')) {
             updateSettingsStats();
        }
    }
    
    function updateNetworkUI() {
        const bars = document.getElementById('kust-network-bars');
        if (!bars) return;
        
        // Reset classes
        bars.className = 'network-bars';
        // THRESHOLDS: 
        // Green: 0-250ms
        // Yellow: 251-350ms
        // Red: 350ms+
        
        if (netStats.ping <= 280 && netStats.packetLoss < 10) {
            bars.classList.add('net-good');
            bars.title = `Excellent: ${netStats.ping}ms`;
        } else if (netStats.ping <= 380 && netStats.packetLoss < 30) {
            bars.classList.add('net-med');
            bars.title = `Moderate: ${netStats.ping}ms`;
        } else {
            bars.classList.add('net-bad');
            bars.title = `Poor: ${netStats.ping}ms (Loss: ~${netStats.packetLoss}%)`;
        }
        
        // If Settings Modal is open, update live stats there too
        const settingsModal = document.getElementById('kust-settings-modal');
        if (settingsModal && settingsModal.classList.contains('open')) {
             updateSettingsStats();
        }
    }
    
    function updateSettingsStats() {
        // --- MAIN SERVER STATS ---
        const latencyEl = document.getElementById('stat-latency');
        const jitterEl = document.getElementById('stat-jitter');
        const lossEl = document.getElementById('stat-loss');
        const serverEl = document.getElementById('stat-server');

        if(latencyEl) {
            latencyEl.innerText = `${netStats.ping}ms`;
            latencyEl.className = `net-stat-value ${netStats.ping <= 250 ? 'stat-good' : netStats.ping <= 350 ? 'stat-warn' : 'stat-bad'}`;
        }
        if(jitterEl) {
            jitterEl.innerText = `±${netStats.jitter}ms`;
            jitterEl.className = `net-stat-value ${netStats.jitter < 10 ? 'stat-good' : 'stat-warn'}`;
        }
        if(lossEl) {
            lossEl.innerText = `~${netStats.packetLoss}%`;
            lossEl.className = `net-stat-value ${netStats.packetLoss === 0 ? 'stat-good' : 'stat-bad'}`;
        }
        if(serverEl) {
            const isMainConnected = webSocket && webSocket.readyState === WebSocket.OPEN;
            serverEl.innerText = isMainConnected ? "ON" : "OFF";
            serverEl.className = `net-stat-value ${isMainConnected ? 'stat-good' : 'stat-bad'}`;
        }

        // --- REGIONAL SERVER STATS ---
        const latencyRegEl = document.getElementById('stat-latency-reg');
        const jitterRegEl = document.getElementById('stat-jitter-reg');
        const lossRegEl = document.getElementById('stat-loss-reg');
        const serverRegEl = document.getElementById('stat-server-reg');

        if(latencyRegEl) {
            latencyRegEl.innerText = `${netStatsReg.ping}ms`;
            latencyRegEl.className = `net-stat-value ${netStatsReg.ping <= 250 ? 'stat-good' : netStatsReg.ping <= 350 ? 'stat-warn' : 'stat-bad'}`;
        }
        if(jitterRegEl) {
            jitterRegEl.innerText = `±${netStatsReg.jitter}ms`;
            jitterRegEl.className = `net-stat-value ${netStatsReg.jitter < 10 ? 'stat-good' : 'stat-warn'}`;
        }
        if(lossRegEl) {
            lossRegEl.innerText = `~${netStatsReg.packetLoss}%`;
            lossRegEl.className = `net-stat-value ${netStatsReg.packetLoss === 0 ? 'stat-good' : 'stat-bad'}`;
        }
        if(serverRegEl) {
            const isRegConnected = hh123Socket && hh123Socket.connected;
            serverRegEl.innerText = isRegConnected ? "ON" : "OFF";
            serverRegEl.className = `net-stat-value ${isRegConnected ? 'stat-good' : 'stat-bad'}`;
        }

        // --- CLAIM STATS ---
        const successEl = document.getElementById('stat-success-count');
        const failedEl = document.getElementById('stat-failed-count');
        const totalValueEl = document.getElementById('stat-total-value');
        const successRateEl = document.getElementById('stat-success-rate');

        if(successEl) {
            successEl.innerText = claimStats.successCount;
            successEl.className = 'claim-stat-value success';
        }
        if(failedEl) {
            failedEl.innerText = claimStats.failedCount;
            failedEl.className = 'claim-stat-value failed';
        }
        if(totalValueEl) {
            totalValueEl.innerText = `$${claimStats.totalClaimedValue.toFixed(2)}`;
        }
        if(successRateEl) {
            const total = claimStats.successCount + claimStats.failedCount;
            const rate = total > 0 ? ((claimStats.successCount / total) * 100).toFixed(1) : 0;
            successRateEl.innerText = `${rate}%`;
            successRateEl.className = `claim-stat-value ${rate >= 50 ? 'success' : 'failed'}`;
        }
    }

    // ================================
    // ⚡ TOKEN 3D OVERLAY TRACKER
    // ================================
    function updateTokenUI() {
        const overlayEl = document.getElementById('kust-token-overlay');
        const countEl = document.getElementById('kust-token-count');
        
        // Ensure UI and Turnstile Manager exist
        if (!overlayEl || !countEl || !turnstileManager) return;

        // Get current token count and max capacity
        const count = turnstileManager.tokenCache.length;
        const max = turnstileManager.maxCacheSize;
        const isGenerating = turnstileManager.isGenerating;

        // Update the text
        countEl.innerText = `${count}/${max}`;

        // Update glowing effects based on state
        if (count === 0) {
            overlayEl.className = 'depleted';
            overlayEl.title = 'Tokens Depleted! Waiting for generation...';
        } else if (isGenerating) {
            overlayEl.className = 'charging';
            overlayEl.title = 'Generating new tokens...';
        } else {
            overlayEl.className = '';
            overlayEl.title = 'Bypass Tokens Ready';
        }
    }

    function updateUsername(name) {
        const userEl = document.getElementById("kust-username");
        if (userEl) {
            userEl.innerText = name;
            userEl.classList.add('active');
        }
    }

    function showLoading() {
        const panel = document.getElementById("kust-panel");
        if (!panel) return;

        // Remove existing loading if any
        const existingLoading = panel.querySelector('.loading-container');
        if (existingLoading) existingLoading.remove();

        const loadingContainer = document.createElement("div");
        loadingContainer.className = "loading-container";
        loadingContainer.innerHTML = `
            <div class="loading">
                <div class="loading-animation"></div>
            </div>
        `;
        panel.appendChild(loadingContainer);
    }

    function hideLoading() {
        const loadingContainer = document.querySelector('.loading-container');
        if (loadingContainer) {
            loadingContainer.remove();
        }
    }

    /**
     * Replaces log panel content with a PREMIUM subscription prompt.
     */
    function showSubscriptionPrompt() {
        const bodyEl = document.querySelector('.kust-body');
        if (!bodyEl) return;

        // Prevent re-rendering if already showing
        if(document.getElementById('kust-subscription-overlay')) return;
        // Clear existing content safely
        bodyEl.innerHTML = `
            <div id="kust-subscription-overlay" style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                width: 100%;
                padding: 24px;
                box-sizing: border-box;
                text-align: center;
                gap:16px;
                animation: fadeIn 0.5s ease;
            ">
                <div style="
                    font-size: 48px;
                    margin-bottom: 8px;
                    filter: drop-shadow(0 0 20px rgba(255, 77, 77, 0.4));
                ">🔒</div>

                <div style="
                    font-size: 18px;
                    font-weight: 800;
                    color: var(--kust-text);
                    letter-spacing: -0.5px;
                ">
                    Access Restricted
                </div>

                <div style="
                    font-size: 13px;
                    color: var(--kust-text-dim);
                    line-height: 1.5;
                    max-width: 260px;
                ">
                    Your premium subscription has expired or is invalid. Renew to continue claiming.
                </div>

                <a href="https://t.me/kustchatbot" target="_blank" style="
                    margin-top: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    padding: 14px;
                    background: linear-gradient(135deg, #00E701 0%, #00b301 100%);
                    color: #000;
                    font-weight: 800;
                    font-size: 13px;
                    border-radius: 12px;
                    text-decoration: none;
                    transition: transform 0.2s, box-shadow 0.2s;
                    box-shadow: 0 4px 20px rgba(0, 231, 1, 0.2);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                    <span>Get Access Now</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </a>

                <div style="
                    font-size: 11px;
                    color: rgba(255,255,255,0.2);
                    margin-top: auto;
                ">
                    ID: <span style="font-family: monospace;">${currentUsername || 'UNKNOWN'}</span>
                </div>
            </div>
        `;
        updateStatus("disconnected", "Sub Expired");
    }

    /**
     * Restore the logs view when subscription is re-validated.
     */
    function restoreLogsView() {
        const bodyEl = document.querySelector('.kust-body');
        if (bodyEl && document.getElementById('kust-subscription-overlay')) {
            bodyEl.innerHTML = `
                <div id="kust-logs"></div>
            `;
            addLog("Subscription Verified. Welcome back!", "success");
        }
    }

    // ================================
    // 📢 RAW JSON REPORTING TO CUSTOM BACKEND
    // ================================
    function reportToBackend(reportData) {
        // Send raw JSON to custom backend interface
        GM_xmlhttpRequest({
            method: "POST",
            url: REPORTING_BACKEND_URL,
            headers: { 
                "Content-Type": "application/json"
            },
            data: JSON.stringify(reportData),
            onload: (res) => {
                // Silent success - backend received the report
            },
            onerror: (e) => {
                // Silent error to prevent UI spam
            }
        });
    }

    // ================================
    // 🔄 TURNSTILE TOKEN MANAGEMENT (Improved)
    // ================================
    class TurnstileManager {
        constructor() {
            this.siteKey = TURNSTILE_SITE_KEY;
            this.widgetId = null;
            this.tokenCache = [];
            this.maxCacheSize = 8; 
            this.initialized = false;
            this.tokenTimeout = 2.6 * 60 * 1000; // 2.6 mins
            this.refreshThreshold = 60 * 1000; // 60 seconds before expiration
            this.maintenanceTimer = null;
            this.maintenanceInterval = 1 * 1000; // 1s to refresh missing ammo faster
            this.isGenerating = false;
            this.isMaintaining = false; // Prevents concurrent overlapping requests causing 600010 and "already rendered" issues
        }

        // Helper to map annoying error codes to human-readable text
        getHumanReadableError(error) {
            const errStr = String(error);
            if (errStr.includes('600010')) return "Cloudflare Timeout / Rate Limit (600010)";
            if (errStr.includes('110200')) return "Invalid/Expired Token Parameter (110200)";
            if (errStr.includes('300030')) return "Challenge Execution Failed (300030)";
            if (errStr.includes('timeout') || errStr.toLowerCase().includes('timeout')) return "Challenge Timeout";
            return `Turnstile Error (${errStr})`;
        }

        async initialize() {
            if (this.initialized) return;
            try {
                await this.loadTurnstileScript();
                if (!unsafeWindow.turnstile) {
                    throw new Error('Turnstile unavailable');
                }
                this.initialized = true;
                addLog('Event Manager initialized', 'success');

                // Generate initial token immediately, do not delay
                this.generateCacheToken();
                
                // Start token maintenance immediately
                this.startTokenMaintenance();
            } catch (error) {
                addLog(`Failed to initialize Turnstile: ${error.message}`, 'error');
            }
        }

        async loadTurnstileScript() {
            return new Promise((resolve, reject) => {
                if (typeof unsafeWindow.turnstile !== 'undefined') {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.id = 'turnstile-scripts';
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                script.type = 'application/javascript';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        createTurnstileContainer() {
            // Check if container already exists and actively destroy it to prevent Cloudflare "already rendered" conflicts
            let existingContainer = document.getElementById('kust-turnstile-container');
            if (existingContainer) {
                existingContainer.remove();
            }

            const container = document.createElement('div');
            container.id = 'kust-turnstile-container';
            container.style.position = 'fixed';
            container.style.top = '-9999px';
            container.style.left = '-9999px';
            container.style.width = '0px';
            container.style.height = '0px';
            container.style.overflow = 'hidden';
            document.body.appendChild(container);
            return container;
        }

        async createToken() {
            this.isGenerating = true;
            return new Promise((resolve, reject) => {
                try {
                    const container = this.createTurnstileContainer();
                    const config = {
                        sitekey: this.siteKey,
                        theme: 'dark',
                        callback: (token) => {
                            this.isGenerating = false;
                            resolve(token);
                        },
                        'error-callback': (error) => {
                            this.isGenerating = false;
                            reject(error);
                        },
                        'timeout-callback': () => {
                            this.isGenerating = false;
                            reject('Get token timeout.');
                        }
                    };

                    this.widgetId = unsafeWindow.turnstile.render(container, config);
      
                } catch (error) {
                    this.isGenerating = false;
                    reject(error);
                }
            });
        }

        async generateCacheToken(retryCount = 0) {
            // If we are already generating on the initial call, prevent overlapping loops
            if (this.isGenerating && retryCount === 0) {
                return;
            }

            // Don't generate if cache is already full
            if (this.tokenCache.length >= this.maxCacheSize) {
                return;
            }

            try {
                let token = await this.createToken();
                const tokenData = {
                    token: token,
                    timestamp: Date.now()
                };
                // Double-check before adding to prevent overfilling
                if (this.tokenCache.length < this.maxCacheSize) {
                    this.tokenCache.push(tokenData);
                }
                this.remove();
            } catch (error) {
                const readableError = this.getHumanReadableError(error);
                this.remove();
                
                // Add retry logic with exponential backoff for specific errors like 600010
                if (retryCount < 3) {
                    if (this.tokenCache.length === 0) {
                        addLog(`Token generation failed (${readableError}). Retrying ${retryCount + 1}/3...`, 'warning');
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1))); // 2s, 4s, 6s Backoff
                    await this.generateCacheToken(retryCount + 1);
                } else {
                    if (this.tokenCache.length === 0) {
                        addLog(`Failed to generate token: ${readableError}`, 'error');
                    }
                }
            }
        }

        // INSTANT SYNC GRABBER - Returns {token, cacheHit, latency}
        getFastTokenWithMetrics() {
            const startTime = performance.now();
            const now = Date.now();
            while (this.tokenCache.length > 0) {
                const tokenData = this.tokenCache.shift();
                if (now - tokenData.timestamp < this.tokenTimeout) {
                    if (this.tokenCache.length < this.maxCacheSize && !this.isGenerating) {
                        this.generateCacheToken();
                    }
                    return {
                        token: tokenData.token,
                        cacheHit: true,
                        latency: Math.round(performance.now() - startTime)
                    };
                }
            }
            return null;
        }

        // Keep old method for backward compatibility
        getFastToken() {
            const result = this.getFastTokenWithMetrics();
            return result ? result.token : null;
        }

        async getTokenWithMetrics() {
            const startTime = performance.now();
            this.cleanExpiredTokens();
            if (this.tokenCache.length > 0) {
                let tokenData = this.tokenCache.shift();
                return {
                    token: tokenData.token,
                    cacheHit: true,
                    latency: Math.round(performance.now() - startTime)
                };
            }

            // Emergency generation with single retry if fallback fails
            try {
                const token = await this.createToken();
                this.remove();
                return {
                    token: token,
                    cacheHit: false,
                    latency: Math.round(performance.now() - startTime)
                };
            } catch (error) {
                this.remove();
                const readableError = this.getHumanReadableError(error);
                addLog(`Emergency token generation failed: ${readableError}. Retrying once...`, 'warning');
                try {
                    const retryToken = await this.createToken();
                    this.remove();
                    return {
                        token: retryToken,
                        cacheHit: false,
                        latency: Math.round(performance.now() - startTime)
                    };
                } catch(e) {
                    this.remove();
                    throw new Error(this.getHumanReadableError(e));
                }
            }
        }

        async getToken() {
            const result = await this.getTokenWithMetrics();
            return result.token;
        }

        cleanExpiredTokens() {
            const now = Date.now();
            this.tokenCache = this.tokenCache.filter(tokenData =>
                now - tokenData.timestamp < this.tokenTimeout
            );
        }

        async maintainTokens() {
            // Adding maintenance lock to prevent overlapping API calls causing DOM overlapping and CF panic
            if (!this.initialized || this.isMaintaining) {
                return;
            }

            this.isMaintaining = true;

            try {
                this.cleanExpiredTokens();
                // Check if any tokens are about to expire and refresh them
                const now = Date.now();
                for (let i = 0; i < this.tokenCache.length; i++) {
                    const tokenData = this.tokenCache[i];
                    const timeUntilExpiration = this.tokenTimeout - (now - tokenData.timestamp);

                    // If token is about to expire, replace it (with robust retries)
                    if (timeUntilExpiration <= this.refreshThreshold) {
                        let success = false;
                        let retry = 0;
                        
                        while (!success && retry < 2) {
                            try {
                                const newToken = await this.createToken();
                                this.tokenCache[i] = {
                                    token: newToken,
                                    timestamp: Date.now()
                                };
                                this.remove();
                                success = true;
                            } catch (error) {
                                retry++;
                                this.remove();
                                const readableError = this.getHumanReadableError(error);
                                if (retry >= 2) {
                                    addLog(`Token refresh error: ${readableError}`, 'error');
                                } else {
                                    await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1 sec before retrying
                                }
                            }
                        }
                    }
                }

                // Generate new tokens if needed (fill the buffer)
                const tokensNeeded = this.maxCacheSize - this.tokenCache.length;
                if (tokensNeeded > 0) {
                    // Loop to spawn tokens. generateCacheToken itself handles internal retries.
                    for (let i = 0; i < tokensNeeded; i++) {
                         await this.generateCacheToken();
                         await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds delay between generation to prevent 401 spam
                    }
                }
            } finally {
                // Free lock
                this.isMaintaining = false;
            }
        }

        startTokenMaintenance() {
            if (this.maintenanceTimer) {
                return;
            }

            this.maintenanceTimer = setInterval(() => {
                this.maintainTokens();
            }, this.maintenanceInterval);
        }

        stopTokenMaintenance() {
            if (this.maintenanceTimer) {
                clearInterval(this.maintenanceTimer);
                this.maintenanceTimer = null;
            }
        }

        remove() {
            if (this.widgetId !== null) {
                try {
                    unsafeWindow.turnstile.remove(this.widgetId);
                } catch (error) {
                    // silently fail cleanup 
                }
                this.widgetId = null;
            }
            // Double assure the DOM node is nuked
            let existing = document.getElementById('kust-turnstile-container');
            if (existing) {
                existing.remove();
            }
        }

        destroy() {
            this.stopTokenMaintenance();
            this.remove();
            this.tokenCache = [];
            this.initialized = false;
        }
    }

    // Initialize Turnstile Manager
    const turnstileManager = new TurnstileManager();
    let turnstileTokens = []; // For backward compatibility

    // ================================
    // 🔄 STAKE API HANDLER (Improved)
    // ================================
    class StakeAPIHandler {
        constructor(sessionToken, apiUrl) {
            this.sessionToken = sessionToken;
            this.apiUrl = apiUrl;
        }

        async makeRequest(query, variables, operationName, operationType = "query") {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: this.apiUrl,
                    headers: OPTIMIZED_HEADERS || {
                        "Content-Type": "application/json",
                        "x-access-token": this.sessionToken,
                        "x-operation-name": operationName,
                        "x-operation-type": operationType,
                        // DYNAMIC HEADERS: EXTRACTED MIRROR
                        "Origin": CURRENT_MIRROR,
                        "Referer": window.location.href
                    },
                    data: JSON.stringify({
                        operationName: operationName,
                        query: query,
                        variables: variables
                    }),
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (error) {
                            reject(error);
                        }
                    },
                    onerror: (error) => {
                        reject(error);
                    }
                });
            });
        }

        async checkBonusCode(code) {
            const query = `
                query BonusCodeInformation($code: String!, $couponType: CouponType!) {
                    bonusCodeInformation(code: $code, couponType: $couponType) {
                        availabilityStatus
                        bonusValue
                        cryptoMultiplier
                    }
                }
            `;
            const variables = {
                code: code,
                couponType: "drop"
            };
            try {
                // Operation type is "query"
                const response = await this.makeRequest(query, variables, "BonusCodeInformation", "query");
                if (response.errors && response.errors.length > 0) {
                    return {
                        success: false,
                        error: response.errors[0].message
                    };
                }

                if (response.data && response.data.bonusCodeInformation) {
                    return {
                        success: true,
                        data: response.data.bonusCodeInformation
                    };
                }

                return {
                    success: false,
                    error: "Invalid response from API"
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        async claimBonusCode(code, currency, turnstileToken) {
            const query = `
                mutation ClaimConditionBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) {
                    claimConditionBonusCode(
                        code: $code
                        currency: $currency
                        turnstileToken: $turnstileToken
                    ) {
                        bonusCode {
                            id
                            code
                            __typename
                        }
                        amount
                        currency
                        user {
                            id
                            balances {
                                available {
                                    amount
                                    currency
                                    __typename
                                }
                                __typename
                            }
                            __typename
                        }
                        __typename
                    }
                }
        `;
            const variables = {
                code: code,
                currency: currency,
                turnstileToken: turnstileToken
            };
            try {
                // Operation type is "query" even though it's a mutation (matches working curl)
                const response = await this.makeRequest(query, variables, "ClaimConditionBonusCode", "query");
                if (response.errors && response.errors.length > 0) {
                    return {
                        success: false,
                        error: response.errors[0].message
                    };
                }

                if (response.data && response.data.claimConditionBonusCode) {
                    return {
                        success: true,
                        data: response.data.claimConditionBonusCode
                    };
                }

                return {
                    success: false,
                    error: "Invalid response from API"
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        async getUserInfo() {
            const query = `
                query UserMeta($name: String, $signupCode: Boolean = false) {
                    user(name: $name) {
                        id
                        name
                        isMuted
                        isRainproof
                        isBanned
                        createdAt
                        campaignSet
                        selfExclude {
                            id
                            status
                            active
                            createdAt
                            expireAt
                        }
                        signupCode @include(if: $signupCode) {
                            id
                            code {
                                id
                                code
                            }
                        }
                    }
                }
            `;
            try {
                const response = await this.makeRequest(query, {}, "UserMeta", "query");
                if (response.errors && response.errors.length > 0) {
                    return {
                        success: false,
                        error: response.errors[0].message
                    };
                }

                if (response.data && response.data.user) {
                    return {
                        success: true,
                        data: response.data.user
                    };
                }

                return {
                    success: false,
                    error: "Invalid response from API"
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        async getConversionRate() {
            const query = `
                query CurrencyNewConversionRate($displayCurrencies: [FiatCurrencyEnum!]!) {
                    info {
                        currencies {
                            name
                                values(displayCurrencies: $displayCurrencies) {
                                currency
                                rate
                            }
                        }
                        }
            }
            `;
            const variables = {
                displayCurrencies: ['usd', 'eur', 'ars', 'jpy', 'cad', 'clp', 'cny', 'dkk', 'ghs', 'idr', 'inr', 'kes', 'krw', 'mxn', 'ngn', 'pen', 'php', 'pln', 'rub', 'try', 'vnd']
            };
            try {
                const response = await this.makeRequest(query, variables, "CurrencyNewConversionRate", "query");
                if (response.errors && response.errors.length > 0) {
                    return {
                        success: false,
                        error: response.errors[0].message
                    };
                }

                if (response.data && response.data.info) {
                    return {
                        success: true,
                        data: response.data.info
                    };
                }

                return {
                    success: false,
                    error: "Invalid response from API"
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }

        async createVaultDeposit(currency, amount) {
            const query = `
                mutation CreateVaultDeposit($currency: CurrencyEnum!, $amount: Float!) {
                    createVaultDeposit(currency: $currency, amount: $amount) {
                        id
                        amount
                        currency
                        user {
                            id
                            balances {
                                available {
                                    amount
                                    currency
                                }
                                vault {
                                    amount
                                    currency
                                }
                            }
                        }
                        __typename
                    }
                }
            `;
            const variables = {
                currency: currency,
                amount: amount
            };
            try {
                const response = await this.makeRequest(query, variables, "CreateVaultDeposit", "query");
                if (response.errors && response.errors.length > 0) {
                    return {
                        success: false,
                        error: response.errors[0].message
                    };
                }

                if (response.data && response.data.createVaultDeposit) {
                    return {
                        success: true,
                        data: response.data.createVaultDeposit
                    };
                }

                return {
                    success: false,
                    error: "Invalid response from API"
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }
    }

    // ================================
    // 🕵️ USER DETECTION API
    // ================================
    async function getStakeUserFromAPI() {
        try {
            // Priority 1: Check for hardcoded session token
            const hardcodedToken = getHardcodedSessionToken();
            let sessionToken = null;
            let tokenSource = 'cookie';
            
            if (hardcodedToken) {
                sessionToken = hardcodedToken;
                tokenSource = 'hardcoded';
                addLog(`🔑 Using hardcoded session token`, 'info');
            } else {
                // Priority 2: Read session cookie
                sessionToken = getCookie("session");
                if (!sessionToken) {
                    addLog(`❌ No session token found (cookie or hardcoded)`, 'error');
                    return null;
                }
            }

            // Store session for later use
            currentSession = sessionToken;
            // Initialize API handler
            stakeApi = new StakeAPIHandler(sessionToken, STAKE_API_URL);
            // Get user info
            const result = await stakeApi.getUserInfo();
            if (result.success && result.data && result.data.name) {
                const username = result.data.name;
                
                // Update UI to show token source
                updateSessionSourceIndicator(tokenSource);
                
                return username;
            } else {
                addLog(`❌ ${result.error || 'No user data in response'}`, 'error');
                return null;
            }
        } catch (error) {
            addLog(`❌ Error fetching user from API: ${error.message}`, 'error');
            return null;
        }
    }

    // Update UI to show session token source
    function updateSessionSourceIndicator(source) {
        const userEl = document.getElementById("kust-username");
        if (userEl) {
            // Remove existing indicator if any
            const existingIndicator = userEl.querySelector('.session-source-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
            
            // Add new indicator
            const indicator = document.createElement('span');
            indicator.className = `session-source-indicator session-source-${source}`;
            indicator.textContent = source === 'hardcoded' ? '🔑' : '🍪';
            indicator.title = source === 'hardcoded' ? 'Using hardcoded token' : 'Using cookie session';
            userEl.appendChild(indicator);
        }
    }

    // ================================
    // 🔐 AUTHORIZATION CHECK
    // ================================
    function checkAuthorization(username) {
        if (!username) {
            return Promise.resolve(false);
        }

        // Prevent multiple simultaneous auth checks
        if (authCheckInProgress) {
            return Promise.resolve(true);
            // Assume authorized if check is already in progress
        }

        authCheckInProgress = true;
        
        // UPDATED: Use the provided AUTH_CHECK_URL
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${AUTH_CHECK_URL}?user=${username}`,
                timeout: 10000,
                onload: (response) => {
                    authCheckInProgress = false;
                    try {
                        const data = JSON.parse(response.responseText);
                        consecutiveAuthFailures = 0;
                        resolve(data.authorized === true);
                    } catch (e) {
                        consecutiveAuthFailures++;
                        if (consecutiveAuthFailures >= 3) {
                            showSubscriptionPrompt();
                        }
                        resolve(false);
                    }
                },
                onerror: () => {
                    authCheckInProgress = false;
                    consecutiveAuthFailures++;
                    if (consecutiveAuthFailures >= 3) {
                        showSubscriptionPrompt();
                    }
                    resolve(false);
                },
                ontimeout: () => {
                    authCheckInProgress = false;
                    consecutiveAuthFailures++;
                    if (consecutiveAuthFailures >= 3) {
                        showSubscriptionPrompt();
                    }
                    resolve(false);
                }
            });
        });
    }

    // ================================
    // 🔄 BONUS CODE CHECKER
    // ================================
    // Function to determine error type from error message
    // Returns the specific error type based on the error message content
    function getErrorType(errorMessage) {
        const msg = (errorMessage || '').toLowerCase();
        
        // Check for bonusCodeInactive - code has been fully claimed
        if (msg.includes('bonuscodeinactive') || 
            msg.includes('code has been fully claimed') || 
            msg.includes('fully claimed') ||
            msg.includes('inactive')) {
            return 'bonusCodeInactive';
        }
        
        // Check for weeklyWagerRequirement
        if (msg.includes('weeklywagerrequirement') || 
            msg.includes('wager requirement')) {
            return 'weeklyWagerRequirement';
        }
        
        // Check for alreadyClaimed
        if (msg.includes('alreadyclaimed') || 
            msg.includes('codealreadyclaimed') || 
            msg.includes('codealreadyredeemed') || 
            msg.includes('already claimed') || 
            msg.includes('have already claimed') ||
            msg.includes('already redeemed')) {
            return 'alreadyClaimed';
        }
        
        // Check for withdrawError
        if (msg.includes('withdrawerror') || 
            msg.includes('withdraw error')) {
            return 'withdrawError';
        }
        
        // Check for emailUnverified
        if (msg.includes('emailunverified') || 
            msg.includes('email unverified')) {
            return 'emailUnverified';
        }
        
        // Check for kycLevelNotSufficient
        if (msg.includes('kyclevelnotsufficient') || 
            msg.includes('verification level') || 
            msg.includes('kyc')) {
            return 'kycLevelNotSufficient';
        }
        
        // Check for dropUnavailable - drop is no longer available
        if (msg.includes('dropunavailable') || 
            msg.includes('drop_unavailable') || 
            msg.includes('drop unavailable')) {
            return 'dropUnavailable';
        }
        
        // Success marker
        if (msg.includes('claim_success')) {
            return 'CLAIM_SUCCESS';
        }
        
        // Unknown error - return the actual error message instead of 'unknown'
        // This ensures the backend receives the exact error message
        return errorMessage || 'unknown';
    }

    // ================================
    // 🔄 UI FORM SUBMISSION LOGIC (FALLBACK)
    // ================================
    function processCodeViaUI(code) {
        // 1. Find form elements
        const codeInput = document.querySelector('input[data-testid="bonus-code"]');
        const submitButton = document.querySelector('button[data-testid="claim-drop"]');

        if (!codeInput || !submitButton) {
            addLog("❌ UI: Bonus Code Form not found. Navigate to the Offers page.", "error");
            return;
        }

        addLog(`🔄 UI: Typing code <span class="code-highlight">${code}</span> and clicking Submit.`, "warning");
        try {
            // 2. Set value and dispatch events
            codeInput.value = code;
            codeInput.dispatchEvent(new Event('input', { bubbles: true }));
            codeInput.dispatchEvent(new Event('change', { bubbles: true }));
            // 3. Click submit (with short delay)
            setTimeout(() => {
                submitButton.click();
                addLog("✅ UI: Submit button clicked. Waiting for modal...", "success");

                // 4. Wait for modal and click dismiss button
                setTimeout(() => {
                    const dismissButton = document.querySelector('button[data-testid="claim-bonus-dismiss"]');
                    if (dismissButton) {
                        dismissButton.click();
                        addLog("✅ UI: Modal dismissed.", "info");
                    } else {
                        addLog("⚠️ UI: Dismiss button not found. Modal may need manual closing.", "warning");
                    }
                }, 300); // Wait 0.3 seconds

            }, 300);
        } catch (e) {
            addLog(`❌ UI Submission Error: ${e.message}`, "error");
        }
    }

    // ================================
    // 🚀 API LOGIC (Fully Optimized for Speed with Latency Tracking)
    // NO AUTO RETRY - Manual retry via "r-" prefix
    // ================================
    function testBonusCode(code, isUncheck = false, wsReceiveTime = null, isRetry = false) {
        if (!code) return addLog("Empty code received", "error");
        
        // Calculate internal processing delay (time from WebSocket receive to processing start)
        const processingStartTime = performance.now();
        let internalDelay = 0;
        if (wsReceiveTime) {
            internalDelay = Math.round(processingStartTime - wsReceiveTime);
        }
        
        // Skip if already claimed (unless it's a retry)
        if (claimedCodes.has(code) && !isRetry) {
            return;
        }
        
        // Skip if currently processing this code
        if (processingCodes.has(code)) {
            return;
        }
        
        // Add to processing set
        processingCodes.add(code);
        
        // Create log entry immediately with processing state
        const logId = addLog(`⏳ Processing code <span class="code-highlight">${code}</span>...`, "info", true);
        
        // Initialize latency info
        let latencyInfo = {
            apiLatency: 0,
            tokenLatency: 0,
            turnstileCacheHit: false,
            totalTime: 0,
            internalDelay: internalDelay
        };

        // Get turnstile token first (with timing)
        const tokenStartTime = performance.now();
        
        // Try fast sync token first, fall back to async
        let fastTokenResult = turnstileManager.getFastTokenWithMetrics();
        
        if (fastTokenResult) {
            // Fast path - token was in cache
            latencyInfo.tokenLatency = fastTokenResult.latency;
            latencyInfo.turnstileCacheHit = fastTokenResult.cacheHit;
            
            const apiCallStartTime = performance.now();
            
            // Direct API call with pre-optimized headers
            const payload = `{"operationName":"ClaimConditionBonusCode","variables":{"code":"${code}","currency":"${selectedCurrency}","turnstileToken":"${fastTokenResult.token}"},"query":"mutation ClaimConditionBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) { claimConditionBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) { bonusCode { id code __typename } amount currency user { id balances { available { amount currency __typename } __typename } __typename } __typename } }"}`;
            
            fetch(STAKE_API_URL, {
                method: 'POST',
                headers: OPTIMIZED_HEADERS,
                body: payload
            })
            .then(r => r.json())
            .then(claimResponse => {
                const apiCallEndTime = performance.now();
                latencyInfo.apiLatency = Math.round(apiCallEndTime - apiCallStartTime);
                latencyInfo.totalTime = Math.round(apiCallEndTime - processingStartTime);
                
                handleClaimResponse(claimResponse, code, fastTokenResult.token, processingStartTime, logId, latencyInfo, wsReceiveTime, isRetry);
            })
            .catch(e => {
                processingCodes.delete(code);
                updateLog(logId, `❌ Network error: ${e.message}`, "error", true);
                
                // Report network error to backend with actual error message
                const reportData = { 
                    username: currentUsername,
                    code: code, 
                    status: "FAILED", 
                    reason: "networkError",
                    error: e.message || "Network error occurred",
                    isRetry: isRetry,
                    timestamp: new Date().toISOString()
                };
                reportToBackend(reportData);
            });
        } else {
            // Slow path - need to generate token
            turnstileManager.getTokenWithMetrics().then(tokenResult => {
                latencyInfo.tokenLatency = tokenResult.latency;
                latencyInfo.turnstileCacheHit = tokenResult.cacheHit;
                
                const apiCallStartTime = performance.now();
                
                const payload = `{"operationName":"ClaimConditionBonusCode","variables":{"code":"${code}","currency":"${selectedCurrency}","turnstileToken":"${tokenResult.token}"},"query":"mutation ClaimConditionBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) { claimConditionBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) { bonusCode { id code __typename } amount currency user { id balances { available { amount currency __typename } __typename } __typename } __typename } }"}`;
                
                fetch(STAKE_API_URL, {
                    method: 'POST',
                    headers: OPTIMIZED_HEADERS,
                    body: payload
                })
                .then(r => r.json())
                .then(claimResponse => {
                    const apiCallEndTime = performance.now();
                    latencyInfo.apiLatency = Math.round(apiCallEndTime - apiCallStartTime);
                    latencyInfo.totalTime = Math.round(apiCallEndTime - processingStartTime);
                    
                    handleClaimResponse(claimResponse, code, tokenResult.token, processingStartTime, logId, latencyInfo, wsReceiveTime, isRetry);
                })
                .catch(e => {
                    processingCodes.delete(code);
                    updateLog(logId, `❌ Network error: ${e.message}`, "error", true);
                    
                    // Report network error to backend with actual error message
                    const reportData = { 
                        username: currentUsername,
                        code: code, 
                        status: "FAILED", 
                        reason: "networkError",
                        error: e.message || "Network error occurred",
                        isRetry: isRetry,
                        timestamp: new Date().toISOString()
                    };
                    reportToBackend(reportData);
                });
            }).catch(e => {
                processingCodes.delete(code);
                const readableError = turnstileManager.getHumanReadableError(e);
                updateLog(logId, `❌ Token generation failed: ${readableError}`, "error", true);
                
                // Report token error to backend with actual error message
                const reportData = { 
                    username: currentUsername,
                    code: code, 
                    status: "FAILED", 
                    reason: "tokenError",
                    error: readableError,
                    isRetry: isRetry,
                    timestamp: new Date().toISOString()
                };
                reportToBackend(reportData);
            });
        }
    }

    async function handleClaimResponse(claimResponse, code, token, startTime, logId, latencyInfo, wsReceiveTime, isRetry = false) {
        const timeTaken = (performance.now() - startTime).toFixed(0);

        // Fix: Retry on invalid turnstile error
        if (claimResponse.errors && claimResponse.errors.length > 0 && claimResponse.errors[0].message === 'error.invalid_turnstile') {
            updateLog(logId, `⚠️ Invalid Turnstile detected. Retrying...`, "warning", true);
            turnstileManager.tokenCache = []; 
            const tokenStartTime = performance.now();
            let newTokenResult = await turnstileManager.getTokenWithMetrics();
            
            const payload = `{"operationName":"ClaimConditionBonusCode","variables":{"code":"${code}","currency":"${selectedCurrency}","turnstileToken":"${newTokenResult.token}"},"query":"mutation ClaimConditionBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) { claimConditionBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) { bonusCode { id code __typename } amount currency user { id balances { available { amount currency __typename } __typename } __typename } __typename } }"}`;
            
            const apiCallStartTime = performance.now();
            
            claimResponse = await fetch(STAKE_API_URL, {
                method: 'POST',
                headers: OPTIMIZED_HEADERS,
                body: payload
            }).then(r => r.json()).catch(e => ({ errors: [{ message: e.message }] }));
            
            const apiCallEndTime = performance.now();
            latencyInfo.apiLatency = Math.round(apiCallEndTime - apiCallStartTime);
            latencyInfo.turnstileCacheHit = false;
            latencyInfo.tokenLatency = Math.round(apiCallEndTime - tokenStartTime);
            latencyInfo.totalTime = Math.round(apiCallEndTime - startTime);
        }

        if (!claimResponse.errors && claimResponse.data && claimResponse.data.claimConditionBonusCode) {
            // SUCCESS
            const data = claimResponse.data.claimConditionBonusCode;
            
            // Update claim statistics
            claimStats.successCount++;
            claimStats.totalClaimedValue += parseFloat(data.amount) || 0;
            
            // Add to recent claims
            claimStats.recentClaims.push({
                username: currentUsername,
                code: code,
                status: 'SUCCESS',
                amount: data.amount,
                currency: data.currency,
                timestamp: new Date().toISOString(),
                latencyInfo: latencyInfo,
                isRetry: isRetry
            });
            if (claimStats.recentClaims.length > 50) claimStats.recentClaims.shift();
            
            updateLog(logId, `✅ Successfully claimed <span class="code-highlight">${code}</span>! Bonus: <span class="value-highlight">${data.amount} ${data.currency}</span>${isRetry ? ' <span class="retry-highlight">(MANUAL RETRY)</span>' : ''}`, "success", true, latencyInfo);
            
            // Remove from processing set
            processingCodes.delete(code);
            
            if (userSettings && userSettings.vault) {
                stakeApi.createVaultDeposit(data.currency, data.amount).then(() => addLog(`✅ Amount deposited to vault`, "success")).catch(() => {});
            }
            
            // Build raw JSON report for custom backend
            const reportData = { 
                username: currentUsername,
                code: code, 
                status: "SUCCESS", 
                message: "Claimed successfully", 
                amount: data.amount,
                currency: data.currency,
                isRetry: isRetry,
                latency: {
                    network: latencyInfo.apiLatency, // Actual API network latency
                    token: latencyInfo.tokenLatency,
                    cacheHit: latencyInfo.turnstileCacheHit,
                    total: latencyInfo.totalTime
                },
                data: data,
                timestamp: new Date().toISOString()
            };
            reportToBackend(reportData);
        } else {
            // FAILURE LOGIC - NO AUTO RETRY
            let failureReason = claimResponse.errors ? claimResponse.errors[0].message : "Unknown error";
            const errorType = getErrorType(failureReason);
            
            // Update failed claim statistics
            claimStats.failedCount++;
            
            // Add to recent claims
            claimStats.recentClaims.push({
                username: currentUsername,
                code: code,
                status: 'FAILED',
                reason: errorType,
                error: failureReason,
                timestamp: new Date().toISOString(),
                latencyInfo: latencyInfo,
                isRetry: isRetry
            });
            if (claimStats.recentClaims.length > 50) claimStats.recentClaims.shift();
            
            // All errors are now non-retryable (no auto retry)
            // Just show the error message
            processingCodes.delete(code);
            
            let logMessage = `❌ Failed to claim <span class="code-highlight">${code}</span>. Reason: ${failureReason}`;
            let logType = "error";
            
            if (errorType === 'bonusCodeInactive') { 
                logMessage = `⚠️ Code <span class="code-highlight">${code}</span> has been fully claimed`; 
                logType = "warning"; 
            } else if (errorType === 'alreadyClaimed') { 
                logMessage = `⚠️ You have already claimed code <span class="code-highlight">${code}</span>`; 
                logType = "warning"; 
            } else if (errorType === 'weeklyWagerRequirement') { 
                logMessage = `⚠️ Wager requirement not met for code <span class="code-highlight">${code}</span>`; 
                logType = "warning"; 
            } else if (errorType === 'withdrawError') { 
                logMessage = `⚠️ Deposit required to claim code <span class="code-highlight">${code}</span>`; 
                logType = "warning"; 
            } else if (errorType === 'emailUnverified') { 
                logMessage = `⚠️ Email verification required for code <span class="code-highlight">${code}</span>`; 
                logType = "warning"; 
            } else if (errorType === 'kycLevelNotSufficient') { 
                logMessage = `⚠️ KYC level insufficient for code <span class="code-highlight">${code}</span>`; 
                logType = "warning"; 
            } else if (errorType === 'dropUnavailable') { 
                logMessage = `⚠️ Drop is no longer available for code <span class="code-highlight">${code}</span>`; 
                logType = "warning"; 
            }
            
            updateLog(logId, logMessage, logType, true, latencyInfo);
            
            // Build raw JSON report for custom backend
            // FIX: When errorType is the actual error message (not a known type), use it as the reason
            // This ensures the exact error is reported to the backend instead of "unknown"
            const reportData = { 
                username: currentUsername,
                code: code, 
                status: "FAILED", 
                reason: errorType, // Now contains actual error message when not a known type
                error: failureReason,
                isRetry: isRetry,
                latency: {
                    network: latencyInfo.apiLatency,
                    token: latencyInfo.tokenLatency,
                    cacheHit: latencyInfo.turnstileCacheHit,
                    total: latencyInfo.totalTime
                },
                timestamp: new Date().toISOString()
            };
            reportToBackend(reportData);
        }
    }

    // ================================
    // 📡 DUAL WEBSOCKET CONNECTIONS
    // ================================

    // 1. MAIN WEBSOCKET (HEROKU)
    function connectWebSocket() {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) return;
        updateStatus("disconnected", "Connecting...");

        try {
            // Append username to WS URL for backend auth
            const wsUrlWithUser = `${WS_SERVER_URL}?user=${currentUsername}`;
            webSocket = new WebSocket(wsUrlWithUser);
            webSocket.onopen = () => {
                addLog("Connected to Main Server", "success");
                updateStatus("connected", "UPLINK ACTIVE");

                // Start token maintenance when connected
                if (turnstileManager && turnstileManager.initialized) {
                    turnstileManager.startTokenMaintenance();
                }
            };
            webSocket.onmessage = (event) => {
                const raw = event.data;
                const receiveTime = performance.now(); // INSTANT TIMER START
                
                // --- OPTIMIZATION: FAST-FAIL PARSING ---
                if (typeof raw !== 'string' || !raw.includes('"code"')) return;
                // ---------------------------------------

                // Check for "r-" prefix for manual retry
                let actualCode = raw;
                let isRetry = false;
                
                // Try to extract code and check for "r-" prefix
                const codeMatch = raw.match(/"code"\s*:\s*"([^"]+)"/);
                if (codeMatch && codeMatch[1]) {
                    actualCode = codeMatch[1];
                    // Check if code starts with "r-" for manual retry
                    if (actualCode.startsWith('r-')) {
                        isRetry = true;
                        actualCode = actualCode.substring(2); // Strip "r-" prefix
                    }
                }

                // --- 🚀 GOD TIER OPTIMIZATION: Bypassing JSON.parse ---
                if (userSettings && userSettings.processAll) {
                    if (codeMatch && codeMatch[1]) {
                        if (!claimedCodes.has(actualCode) || isRetry) {
                            // FIRE IMMEDIATELY without waiting for JSON parse
                            testBonusCode(actualCode, false, receiveTime, isRetry);
                        }
                        // Silently ignore duplicate codes
                    }
                    return; // Skip standard parsing if processed via regex
                } 
                // --------------------------------------------------------

                try {
                    const payload = JSON.parse(raw);
                    let messageData = null;

                    // If outer wrapper indicates sub_code_v2 OR stake_bonus_code, use inner msg
                    if (payload && (payload.type === "sub_code_v2" || payload.type === "stake_bonus_code") && payload.msg) {
                        messageData = payload.msg;
                    } 
                    // Legacy or other format where msg exists - prefer inner msg if present
                    else if (payload && payload.msg) {
                        messageData = payload.msg;
                    } 
                    // Fallback: use payload directly
                    else {
                        messageData = payload;
                    }

                    // If after extraction we still have a lingering 'type' field equal to 'sub_code_v2' or 'stake_bonus_code', remove it
                    if (messageData && (messageData.type === "sub_code_v2" || messageData.type === "stake_bonus_code")) {
                        if (messageData.msg) {
                            // If inner msg exists, unwrap it
                            messageData = messageData.msg;
                        } else {
                            // Otherwise just remove the irrelevant wrapper type
                            delete messageData.type;
                        }
                    }

                    if (messageData && messageData.code) {
                        // Check for "r-" prefix in the code for manual retry
                        let code = messageData.code;
                        let isManualRetry = false;
                        
                        if (code.startsWith('r-')) {
                            isManualRetry = true;
                            code = code.substring(2); // Strip "r-" prefix
                        }
                        
                        if (!claimedCodes.has(code) || isManualRetry) {
                            testBonusCode(code, false, receiveTime, isManualRetry);
                        }
                    }
                } catch (e) {
                    // JSON parse failed, ignore
                }
            };
            webSocket.onclose = () => {
                updateStatus("disconnected", "Reconnecting...");
                // Attempt reconnection after 3 seconds
                setTimeout(connectWebSocket, 3000);
            };
            webSocket.onerror = () => {
                updateStatus("disconnected", "Connection Error");
            };
        } catch (e) {
            updateStatus("disconnected", "Connection Failed");
            setTimeout(connectWebSocket, 5000);
        }
    }

    // 2. REGIONAL WEBSOCKET (HH123)
    function connectRegionalSocket() {
        if (hh123Socket && hh123Socket.connected) return;

        // Load Socket.IO client script dynamically
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
        script.onload = () => {
            try {
                hh123Socket = io(HH123_URL, {
                    transports: ['websocket', 'polling'],
                    query: {
                        username: HH123_USERNAME,
                        version: HH123_VERSION
                    }
                });

                hh123Socket.on('connect', () => {
                    addLog("Connected to Regional Server (HH123)", "success");
                });

                hh123Socket.on('bonus_code', (data) => {
                    // Process bonus code from regional server
                    if (data && data.code) {
                        let code = data.code;
                        let isRetry = false;
                        
                        // Check for "r-" prefix for manual retry
                        if (code.startsWith('r-')) {
                            isRetry = true;
                            code = code.substring(2);
                        }
                        
                        if (!claimedCodes.has(code) || isRetry) {
                            testBonusCode(code, false, performance.now(), isRetry);
                        }
                    }
                });

                hh123Socket.on('disconnect', () => {
                    addLog("Disconnected from Regional Server", "warning");
                });

                hh123Socket.on('connect_error', () => {
                    // Silent fail for regional server
                });

            } catch (e) {
                // Silent fail for regional server
            }
        };
        document.head.appendChild(script);
    }

    // ================================
    // 🔧 SETTINGS MODAL
    // ================================
    function createSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'kust-settings-modal';
        modal.innerHTML = `
            <div class="kust-settings-popup">
                <div class="settings-popup-header">
                    <div class="settings-popup-title">⚙️ Settings</div>
                    <div class="settings-popup-close" onclick="document.getElementById('kust-settings-modal').classList.remove('open')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </div>
                </div>
                <div class="settings-popup-content">
                    <div class="settings-section">
                        <div class="settings-section-title">📊 Network Statistics (Main Server)</div>
                        <div class="net-stats-grid">
                            <div class="net-stat-item">
                                <div class="net-stat-label">Latency</div>
                                <div class="net-stat-value" id="stat-latency">0ms</div>
                            </div>
                            <div class="net-stat-item">
                                <div class="net-stat-label">Jitter</div>
                                <div class="net-stat-value" id="stat-jitter">±0ms</div>
                            </div>
                            <div class="net-stat-item">
                                <div class="net-stat-label">Packet Loss</div>
                                <div class="net-stat-value" id="stat-loss">~0%</div>
                            </div>
                            <div class="net-stat-item">
                                <div class="net-stat-label">Server</div>
                                <div class="net-stat-value" id="stat-server">OFF</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <div class="settings-section-title">📊 Network Statistics (Regional Server)</div>
                        <div class="net-stats-grid">
                            <div class="net-stat-item">
                                <div class="net-stat-label">Latency</div>
                                <div class="net-stat-value" id="stat-latency-reg">0ms</div>
                            </div>
                            <div class="net-stat-item">
                                <div class="net-stat-label">Jitter</div>
                                <div class="net-stat-value" id="stat-jitter-reg">±0ms</div>
                            </div>
                            <div class="net-stat-item">
                                <div class="net-stat-label">Packet Loss</div>
                                <div class="net-stat-value" id="stat-loss-reg">~0%</div>
                            </div>
                            <div class="net-stat-item">
                                <div class="net-stat-label">Server</div>
                                <div class="net-stat-value" id="stat-server-reg">OFF</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <div class="settings-section-title">📈 Claim Statistics</div>
                        <div class="claim-stats-grid">
                            <div class="claim-stat-item">
                                <div class="claim-stat-label">Success</div>
                                <div class="claim-stat-value success" id="stat-success-count">0</div>
                            </div>
                            <div class="claim-stat-item">
                                <div class="claim-stat-label">Failed</div>
                                <div class="claim-stat-value failed" id="stat-failed-count">0</div>
                            </div>
                            <div class="claim-stat-item">
                                <div class="claim-stat-label">Total Value</div>
                                <div class="claim-stat-value" id="stat-total-value">$0.00</div>
                            </div>
                            <div class="claim-stat-item">
                                <div class="claim-stat-label">Success Rate</div>
                                <div class="claim-stat-value" id="stat-success-rate">0%</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <div class="settings-section-title">🎮 Preferences</div>
                        <div class="settings-option">
                            <input type="checkbox" class="settings-checkbox" id="setting-process-all" ${userSettings && userSettings.processAll ? 'checked' : ''}>
                            <label class="settings-label" for="setting-process-all">Process all codes (bypass JSON parsing)</label>
                        </div>
                        <div class="settings-option">
                            <input type="checkbox" class="settings-checkbox" id="setting-vault" ${userSettings && userSettings.vault ? 'checked' : ''}>
                            <label class="settings-label" for="setting-vault">Auto-deposit claimed amounts to vault</label>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <div class="settings-section-title">💱 Currency</div>
                        <select class="settings-select" id="setting-currency">
                            <option value="usdt" ${selectedCurrency === 'usdt' ? 'selected' : ''}>USDT</option>
                            <option value="btc" ${selectedCurrency === 'btc' ? 'selected' : ''}>BTC</option>
                            <option value="eth" ${selectedCurrency === 'eth' ? 'selected' : ''}>ETH</option>
                            <option value="ltc" ${selectedCurrency === 'ltc' ? 'selected' : ''}>LTC</option>
                            <option value="doge" ${selectedCurrency === 'doge' ? 'selected' : ''}>DOGE</option>
                            <option value="trx" ${selectedCurrency === 'trx' ? 'selected' : ''}>TRX</option>
                            <option value="bch" ${selectedCurrency === 'bch' ? 'selected' : ''}>BCH</option>
                            <option value="xrp" ${selectedCurrency === 'xrp' ? 'selected' : ''}>XRP</option>
                            <option value="eos" ${selectedCurrency === 'eos' ? 'selected' : ''}>EOS</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add event listeners for settings
        const processAllCheckbox = document.getElementById('setting-process-all');
        const vaultCheckbox = document.getElementById('setting-vault');
        const currencySelect = document.getElementById('setting-currency');

        if (processAllCheckbox) {
            processAllCheckbox.addEventListener('change', (e) => {
                userSettings = userSettings || {};
                userSettings.processAll = e.target.checked;
                GM_setValue(FC_USER_SETTINGS, userSettings);
            });
        }

        if (vaultCheckbox) {
            vaultCheckbox.addEventListener('change', (e) => {
                userSettings = userSettings || {};
                userSettings.vault = e.target.checked;
                GM_setValue(FC_USER_SETTINGS, userSettings);
            });
        }

        if (currencySelect) {
            currencySelect.addEventListener('change', (e) => {
                selectedCurrency = e.target.value;
                userSettings = userSettings || {};
                userSettings.currency = selectedCurrency;
                GM_setValue(FC_USER_SETTINGS, userSettings);
            });
        }
    }

    // ================================
    // 🎨 CREATE PREMIUM UI
    // ================================
    function createUI() {
        // Check if UI already exists
        if (document.getElementById('kust-panel')) return;

        // Load saved settings
        userSettings = GM_getValue(FC_USER_SETTINGS, null);
        if (userSettings && userSettings.currency) {
            selectedCurrency = userSettings.currency;
        }

        // Create main panel
        const panel = document.createElement('div');
        panel.id = 'kust-panel';
        panel.innerHTML = `
            <div class="kust-header">
                <div class="kust-header-left">
                    <div class="kust-title">KUST CLAIMER</div>
                    <div class="kust-username" id="kust-username">Connecting...</div>
                </div>
                <div class="kust-header-right">
                    <div class="network-bars" id="kust-network-bars" title="Network Quality">
                        <div class="net-bar"></div>
                        <div class="net-bar"></div>
                        <div class="net-bar"></div>
                    </div>
                    <div class="kust-settings-btn" onclick="document.getElementById('kust-settings-modal').classList.add('open')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                        </svg>
                    </div>
                    <div class="kust-status" id="kust-status-badge">
                        <div class="status-dot"></div>
                        <span id="kust-status-text">Connecting...</span>
                    </div>
                </div>
            </div>
            <div class="kust-body">
                <div id="kust-logs"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // Create token overlay
        const tokenOverlay = document.createElement('div');
        tokenOverlay.id = 'kust-token-overlay';
        tokenOverlay.innerHTML = `
            <div class="token-3d-icon">🔐</div>
            <div class="token-3d-text">
                <div class="token-3d-label">Bypass Tokens</div>
                <div class="token-3d-value" id="kust-token-count">0/8</div>
            </div>
        `;
        document.body.appendChild(tokenOverlay);

        // Create settings modal
        createSettingsModal();

        // Make panel draggable
        makeDraggable(panel);

        // Update token UI periodically
        setInterval(updateTokenUI, 1000);
    }

    // ================================
    // 🖱️ DRAGGABLE FUNCTIONALITY
    // ================================
    function makeDraggable(element) {
        const header = element.querySelector('.kust-header');
        if (!header) return;

        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.kust-settings-btn') || e.target.closest('.kust-status')) return;
            
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, element);
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate(${xPos}px, ${yPos}px)`;
    }

    // ================================
    // 🚀 INITIALIZATION
    // ================================
    async function init() {
        // Create UI
        createUI();

        // Show loading
        showLoading();

        // Get user from API
        currentUsername = await getStakeUserFromAPI();
        
        if (!currentUsername) {
            hideLoading();
            addLog("❌ Failed to get username. Please refresh the page.", "error");
            updateStatus("disconnected", "Auth Failed");
            return;
        }

        // Update username in UI
        updateUsername(currentUsername);
        addLog(`👤 Logged in as: ${currentUsername}`, "info");

        // Check authorization
        const isAuthorized = await checkAuthorization(currentUsername);
        if (!isAuthorized) {
            hideLoading();
            showSubscriptionPrompt();
            return;
        }

        // Restore logs view if subscription prompt was shown
        restoreLogsView();

        // Initialize turnstile manager
        await turnstileManager.initialize();

        // Build optimized headers
        OPTIMIZED_HEADERS = {
            "Content-Type": "application/json",
            "x-access-token": currentSession,
            "x-operation-name": "ClaimConditionBonusCode",
            "x-operation-type": "query",
            "Origin": CURRENT_MIRROR,
            "Referer": window.location.href
        };

        // Connect to WebSocket servers
        connectWebSocket();
        connectRegionalSocket();

        // Start network monitoring
        setInterval(activePingCheck, 5000);
        setInterval(activeRegionalPingCheck, 5000);

        // Hide loading
        hideLoading();

        addLog("✅ System initialized and ready!", "success");
    }

    // Start the script
    init();
})();
