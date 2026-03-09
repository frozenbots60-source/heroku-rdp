import time
import os
import subprocess
import sys
import shutil
import zipfile
import json

# ================================
# CONFIGURATION
# ================================
SESSION_TOKEN = os.environ.get('SESSION_TOKEN', '6b4aa7c720e25ec7189a624d3e769979b07d3b3fc9ae65036559f81fb0694bc5e5ecf80bbd82ed7329e32de67887aab2')
USERNAME = "kustxoxo"

# Paths
WORKDIR = "/app"
SOURCE_XPI = os.path.join(WORKDIR, "claimer.xpi")
EXTENSION_DIR = os.path.join(WORKDIR, "kust_extension")
PROFILE_DIR = "/tmp/firefox-profile"

def setup_extension():
    """Unpacks XPI, injects token, and prepares the extension folder."""
    print("=" * 60, flush=True)
    print("[EXTENSION SETUP] Starting extension setup...", flush=True)
    print("=" * 60, flush=True)

    # 1. Check if source XPI exists
    if not os.path.exists(SOURCE_XPI):
        print(f"[EXTENSION SETUP] ❌ ERROR: {SOURCE_XPI} not found!", flush=True)
        sys.exit(1)

    # 2. Create a clean extension directory
    if os.path.exists(EXTENSION_DIR):
        shutil.rmtree(EXTENSION_DIR)
    os.makedirs(EXTENSION_DIR)
    print(f"[EXTENSION SETUP] Created extension directory: {EXTENSION_DIR}", flush=True)

    # 3. Unpack the XPI
    print(f"[EXTENSION SETUP] Unpacking {SOURCE_XPI}...", flush=True)
    try:
        with zipfile.ZipFile(SOURCE_XPI, 'r') as zip_ref:
            zip_ref.extractall(EXTENSION_DIR)
        print("[EXTENSION SETUP] ✓ Unpacked successfully.", flush=True)
    except Exception as e:
        print(f"[EXTENSION SETUP] ❌ ERROR unpacking: {e}", flush=True)
        sys.exit(1)

    # 4. Force ID in Manifest (Required for auto-loading)
    # This ensures the pointer file method works 100% of the time.
    manifest_path = os.path.join(EXTENSION_DIR, "manifest.json")
    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        
        # Define our specific ID
        ext_id = "kust-claimer@bot.com"
        
        # Add browser_specific_settings if not present
        if "browser_specific_settings" not in manifest:
            manifest["browser_specific_settings"] = {}
        if "gecko" not in manifest["browser_specific_settings"]:
            manifest["browser_specific_settings"]["gecko"] = {}
            
        manifest["browser_specific_settings"]["gecko"]["id"] = ext_id
        
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)
            
        print(f"[EXTENSION SETUP] ✓ Forced extension ID in manifest: {ext_id}", flush=True)
    except Exception as e:
        print(f"[EXTENSION SETUP] ⚠️ Warning: Could not modify manifest.json: {e}", flush=True)

    # 5. Process the JS script (Inject Token and Username)
    # Find the JS file (assuming it's claim.js or kust_claimer.js)
    js_files = [f for f in os.listdir(EXTENSION_DIR) if f.endswith('.js') and 'background' not in f.lower()]
    
    if not js_files:
        print("[EXTENSION SETUP] ⚠️ Warning: No content script found to inject.", flush=True)
    else:
        # Inject into the first found content script
        target_js = js_files[0]
        js_path = os.path.join(EXTENSION_DIR, target_js)
        
        print(f"[EXTENSION SETUP] Injecting config into: {target_js}", flush=True)

        with open(js_path, "r") as f:
            script_content = f.read()
        
        inject_config = f"""
    // --- AUTO INJECTED CONFIG ---
    window.KustClaimerConfig = {{ SESSION_TOKEN: '{SESSION_TOKEN}', USERNAME: '{USERNAME}' }};
    // ----------------------------
    """
        
        final_script = inject_config + script_content
        
        with open(js_path, "w") as f:
            f.write(final_script)
        
        print(f"[EXTENSION SETUP] ✓ Token and Username injected.", flush=True)
    
    print("\n[EXTENSION SETUP] ✓ Extension setup complete!", flush=True)
    print("=" * 60, flush=True)

def main():
    print("\n" + "=" * 60, flush=True)
    print("🤖 BOT STARTING", flush=True)
    print("=" * 60, flush=True)
    print(f"Working Directory: {WORKDIR}", flush=True)
    print(f"Profile Directory: {PROFILE_DIR}", flush=True)
    print(f"Session Token: {SESSION_TOKEN[:20]}...", flush=True)
    print(f"Username: {USERNAME}", flush=True)
    print("=" * 60 + "\n", flush=True)
    
    print("[MAIN] Waiting for Xvfb...", flush=True)
    time.sleep(5)
    print("[MAIN] ✓ Xvfb should be ready", flush=True)

    # 1. Setup the extension
    setup_extension()

    # 2. Create Profile Directory
    if not os.path.exists(PROFILE_DIR):
        os.makedirs(PROFILE_DIR)

    # 3. Write Preferences
    prefs_path = os.path.join(PROFILE_DIR, "user.js")
    print(f"[MAIN] Writing Firefox preferences...", flush=True)
    
    # Preferences: Allow unsigned, go straight to stake.com, anti-detect
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

    # 4. Prepare Extension Pointer
    extensions_install_dir = os.path.join(PROFILE_DIR, "extensions")
    if not os.path.exists(extensions_install_dir):
        os.makedirs(extensions_install_dir)
    
    # The filename MUST match the ID we set in the manifest
    pointer_file = os.path.join(extensions_install_dir, "kust-claimer@bot.com")
    with open(pointer_file, "w") as f:
        f.write(EXTENSION_DIR)
    print(f"[MAIN] ✓ Extension pointer created: {pointer_file}", flush=True)

    # 5. Launch Firefox
    print("\n" + "=" * 60, flush=True)
    print("[MAIN] 🚀 Starting Firefox...", flush=True)
    print("=" * 60, flush=True)
    
    cmd = [
        "firefox",
        "--display=:0",
        f"--profile={PROFILE_DIR}",
        "--no-remote"
    ]
    
    print(f"[MAIN] Firefox command: {' '.join(cmd)}", flush=True)

    process = subprocess.Popen(cmd, env={**os.environ, "DISPLAY": ":0"})
    
    print("\n" + "=" * 60, flush=True)
    print("🔥 FIREFOX LAUNCHED SUCCESSFULLY", flush=True)
    print("=" * 60, flush=True)
    print("\n[STATUS]", flush=True)
    print(f"  Extension Loaded from: {EXTENSION_DIR}", flush=True)
    print(f"  Target URL: https://stake.com/settings/offers", flush=True)
    print(f"  Session Token: {SESSION_TOKEN[:20]}...", flush=True)
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
