import time
import os
import subprocess
import sys
import shutil

# ================================
# CONFIGURATION
# ================================
# Paths
WORKDIR = "/app"
EXTENSION_DIR = os.path.join(WORKDIR, "claimer")
PROFILE_DIR = "/tmp/firefox-profile"

# Firefox System Paths (Standard Ubuntu locations)
FIREFOX_CFG_PATH = "/usr/lib/firefox/mozilla.cfg"
AUTOCONFIG_JS_PATH = "/usr/lib/firefox/defaults/pref/autoconfig.js"

def verify_extension():
    """Verifies that the claimer folder and manifest exist."""
    print("=" * 60, flush=True)
    print("[EXTENSION SETUP] Verifying extension directory...", flush=True)
    print("=" * 60, flush=True)

    if not os.path.exists(EXTENSION_DIR):
        print(f"[EXTENSION SETUP] ❌ ERROR: Directory {EXTENSION_DIR} not found!", flush=True)
        sys.exit(1)

    manifest_path = os.path.join(EXTENSION_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"[EXTENSION SETUP] ❌ ERROR: manifest.json not found inside {EXTENSION_DIR}!", flush=True)
        sys.exit(1)

    print(f"[EXTENSION SETUP] ✓ Extension folder ready at: {EXTENSION_DIR}", flush=True)
    print("=" * 60, flush=True)

def setup_autoconfig():
    """
    Writes the AutoConfig files that force Firefox to install the extension.
    This is the most reliable method for containerized environments.
    """
    print("[MAIN] Writing AutoConfig files...", flush=True)
    
    # 1. Write autoconfig.js (Tells Firefox to read mozilla.cfg)
    autoconfig_content = """pref("general.config.filename", "mozilla.cfg");
pref("general.config.obscure_value", 0);
"""
    # Ensure directory exists
    os.makedirs(os.path.dirname(AUTOCONFIG_JS_PATH), exist_ok=True)
    
    with open(AUTOCONFIG_JS_PATH, "w") as f:
        f.write(autoconfig_content)

    # 2. Write mozilla.cfg (The actual script to load extension)
    # We use a safe variable name to avoid path issues
    cfg_content = f"""//
try {{
    var extPath = "{EXTENSION_DIR}";
    Components.utils.import("resource://gre/modules/Addons.jsm");
    AddonManager.installAddonFromLocation(extPath);
}} catch(e) {{}}
"""
    with open(FIREFOX_CFG_PATH, "w") as f:
        f.write(cfg_content)
        
    print("[MAIN] ✓ AutoConfig files written.", flush=True)

def main():
    print("\n" + "=" * 60, flush=True)
    print("🤖 BOT STARTING", flush=True)
    print("=" * 60, flush=True)
    print(f"Working Directory: {WORKDIR}", flush=True)
    print(f"Profile Directory: {PROFILE_DIR}", flush=True)
    print("=" * 60 + "\n", flush=True)
    
    print("[MAIN] Waiting for Xvfb...", flush=True)
    time.sleep(5)
    print("[MAIN] ✓ Xvfb should be ready", flush=True)

    # 1. Verify the extension folder exists
    verify_extension()

    # 2. Setup AutoConfig (Force load extension from /app/claimer)
    setup_autoconfig()

    # 3. Create Clean Profile Directory
    if os.path.exists(PROFILE_DIR):
        shutil.rmtree(PROFILE_DIR)
    os.makedirs(PROFILE_DIR)

    # 4. Write Preferences
    prefs_path = os.path.join(PROFILE_DIR, "user.js")
    print(f"[MAIN] Writing Firefox preferences...", flush=True)
    
    prefs_content = f"""
    // Extension settings
    user_pref("xpinstall.signatures.required", false);
    user_pref("extensions.autoDisableScopes", 0);
    user_pref("extensions.enabledScopes", 15);
    
    // Developer mode settings
    user_pref("devtools.chrome.enabled", true);
    user_pref("devtools.debugger.remote-enabled", true);
    user_pref("devtools.debugger.prompt-connection", false);
    
    // Extension debugging
    user_pref("extensions.sdk.console.logLevel", "all");
    user_pref("browser.dom.window.dump.enabled", true);
    user_pref("javascript.options.showInConsole", true);
    user_pref("extensions.logging.enabled", true);
    
    // Anti-detection
    user_pref("dom.webdriver.enabled", false);
    user_pref("general.appname.override", "Netscape");
    user_pref("general.appversion.override", "5.0 (Windows)");
    user_pref("general.platform.override", "Win32");
    user_pref("general.oscpu.override", "Windows NT 10.0; Win64; x64");
    
    // STARTUP - Go straight to Stake
    user_pref("browser.startup.homepage", "https://stake.com/settings/offers");
    user_pref("browser.startup.page", 1);
    user_pref("browser.startup.homepage_override.mstone", "ignore");
    """
    
    with open(prefs_path, "w") as f:
        f.write(prefs_content)
    print("[MAIN] ✓ Preferences written.", flush=True)

    # 5. Launch Firefox
    print("\n" + "=" * 60, flush=True)
    print("[MAIN] 🚀 Starting Firefox...", flush=True)
    print("=" * 60, flush=True)
    
    cmd = [
        "firefox",
        "--display=:0",
        f"--profile={PROFILE_DIR}",
        "--no-remote",
        "--no-sandbox"  # CRITICAL: Fixes the EPERM/Sandbox error
    ]
    
    print(f"[MAIN] Firefox command: {' '.join(cmd)}", flush=True)

    # Pass the DISPLAY environment variable so it renders on your VNC screen
    process = subprocess.Popen(cmd, env={**os.environ, "DISPLAY": ":0"})
    
    print("\n" + "=" * 60, flush=True)
    print("🔥 FIREFOX LAUNCHED SUCCESSFULLY", flush=True)
    print("=" * 60, flush=True)
    print("\n[STATUS]", flush=True)
    print(f"  Extension Loaded from: {EXTENSION_DIR}", flush=True)
    print(f"  Target URL: https://stake.com/settings/offers", flush=True)
    print("=" * 60 + "\n", flush=True)
    
    try:
        counter = 0
        while True:
            time.sleep(60)
            counter += 1
            if process.poll() is not None:
                print(f"[MAIN] ⚠️ Firefox process ended with code: {process.returncode}", flush=True)
                break
            print(f"[MAIN] Bot running for {counter} minute(s) - PID: {process.pid}", flush=True)
    except KeyboardInterrupt:
        print("\n[MAIN] Received interrupt signal, killing Firefox...", flush=True)
        process.kill()
        print("[MAIN] ✓ Firefox killed. Exiting.", flush=True)

if __name__ == "__main__":
    main()
