import time
import os
import subprocess
import sys
import shutil

# ================================
# CONFIGURATION
# ================================
SESSION_TOKEN = os.environ.get('SESSION_TOKEN', '6b4aa7c720e25ec7189a624d3e769979b07d3b3fc9ae65036559f81fb0694bc5e5ecf80bbd82ed7329e32de67887aab2')
USERNAME = "kustxoxo"

# Paths
WORKDIR = "/app"
EXTENSION_DIR = os.path.join(WORKDIR, "kust_extension")
PROFILE_DIR = "/tmp/firefox-profile"

def setup_extension():
    """Injects the token into the script and creates the extension folder."""
    print("=" * 60, flush=True)
    print("[EXTENSION SETUP] Starting extension setup...", flush=True)
    print("=" * 60, flush=True)

    # 1. Create a clean extension directory
    if os.path.exists(EXTENSION_DIR):
        print(f"[EXTENSION SETUP] Removing existing extension directory: {EXTENSION_DIR}", flush=True)
        shutil.rmtree(EXTENSION_DIR)
    os.makedirs(EXTENSION_DIR)
    print(f"[EXTENSION SETUP] Created extension directory: {EXTENSION_DIR}", flush=True)

    # 2. Copy manifest.json
    manifest_src = os.path.join(WORKDIR, "manifest.json")
    manifest_dst = os.path.join(EXTENSION_DIR, "manifest.json")
    
    if not os.path.exists(manifest_src):
        print("[EXTENSION SETUP] ❌ ERROR: manifest.json not found!", flush=True)
        sys.exit(1)
    
    shutil.copy(manifest_src, manifest_dst)
    print(f"[EXTENSION SETUP] ✓ manifest.json copied to: {manifest_dst}", flush=True)
    
    # Log manifest content
    with open(manifest_dst, "r") as f:
        manifest_content = f.read()
    print(f"[EXTENSION SETUP] manifest.json content:\n{manifest_content}", flush=True)

    # 3. Process the JS script (Inject Token and Username)
    js_path = os.path.join(WORKDIR, "kust_claimer.js")
    if not os.path.exists(js_path):
        print("[EXTENSION SETUP] ❌ ERROR: kust_claimer.js not found!", flush=True)
        sys.exit(1)

    print(f"[EXTENSION SETUP] Found kust_claimer.js at: {js_path}", flush=True)

    with open(js_path, "r") as f:
        script_content = f.read()
    
    print(f"[EXTENSION SETUP] Original script size: {len(script_content)} bytes", flush=True)

    # Replace the default empty token/username with real ones
    # We do this by adding a line at the very top of the script
    inject_config = f"""
    // --- AUTO INJECTED CONFIG ---
    window.KustClaimerConfig = {{ SESSION_TOKEN: '{SESSION_TOKEN}', USERNAME: '{USERNAME}' }};
    // ----------------------------
    """
    
    final_script = inject_config + script_content
    print(f"[EXTENSION SETUP] Injected config - SESSION_TOKEN: {SESSION_TOKEN[:20]}...", flush=True)
    print(f"[EXTENSION SETUP] Injected config - USERNAME: {USERNAME}", flush=True)
    print(f"[EXTENSION SETUP] Final script size: {len(final_script)} bytes", flush=True)

    # Save to extension folder
    final_js_path = os.path.join(EXTENSION_DIR, "kust_claimer.js")
    with open(final_js_path, "w") as f:
        f.write(final_script)
    
    print(f"[EXTENSION SETUP] ✓ Script saved to: {final_js_path}", flush=True)
    
    # Log first 500 chars of injected script
    print(f"[EXTENSION SETUP] Injected script preview (first 500 chars):\n{final_script[:500]}...", flush=True)
    
    # Verify extension files
    print("\n[EXTENSION SETUP] Verifying extension files:", flush=True)
    for root, dirs, files in os.walk(EXTENSION_DIR):
        for file in files:
            filepath = os.path.join(root, file)
            size = os.path.getsize(filepath)
            print(f"[EXTENSION SETUP]   ✓ {filepath} ({size} bytes)", flush=True)
    
    print("\n[EXTENSION SETUP] ✓ Extension setup complete!", flush=True)
    print("=" * 60, flush=True)

def verify_extension_installation():
    """Verify that the extension files are properly in place."""
    print("\n[EXTENSION VERIFY] Checking extension installation...", flush=True)
    
    # Check extension directory
    if not os.path.exists(EXTENSION_DIR):
        print("[EXTENSION VERIFY] ❌ Extension directory does not exist!", flush=True)
        return False
    print(f"[EXTENSION VERIFY] ✓ Extension directory exists: {EXTENSION_DIR}", flush=True)
    
    # Check manifest
    manifest_path = os.path.join(EXTENSION_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print("[EXTENSION VERIFY] ❌ manifest.json missing!", flush=True)
        return False
    print(f"[EXTENSION VERIFY] ✓ manifest.json exists", flush=True)
    
    # Check script
    script_path = os.path.join(EXTENSION_DIR, "kust_claimer.js")
    if not os.path.exists(script_path):
        print("[EXTENSION VERIFY] ❌ kust_claimer.js missing!", flush=True)
        return False
    print(f"[EXTENSION VERIFY] ✓ kust_claimer.js exists", flush=True)
    
    # Check for injected config
    with open(script_path, "r") as f:
        content = f.read()
    if "KustClaimerConfig" in content:
        print("[EXTENSION VERIFY] ✓ Config injection detected in script", flush=True)
    else:
        print("[EXTENSION VERIFY] ❌ Config injection NOT found in script!", flush=True)
        return False
    
    print("[EXTENSION VERIFY] ✓ All extension files verified successfully!", flush=True)
    return True

def main():
    print("\n" + "=" * 60, flush=True)
    print("🤖 BOT STARTING", flush=True)
    print("=" * 60, flush=True)
    print(f"Working Directory: {WORKDIR}", flush=True)
    print(f"Extension Directory: {EXTENSION_DIR}", flush=True)
    print(f"Profile Directory: {PROFILE_DIR}", flush=True)
    print(f"Session Token: {SESSION_TOKEN[:20]}...", flush=True)
    print(f"Username: {USERNAME}", flush=True)
    print("=" * 60 + "\n", flush=True)
    
    print("[MAIN] Waiting for Xvfb...", flush=True)
    time.sleep(5)
    print("[MAIN] ✓ Xvfb should be ready", flush=True)

    # 1. Setup the extension with the current token
    setup_extension()

    # 2. Verify extension installation
    if not verify_extension_installation():
        print("[MAIN] ❌ Extension verification failed! Exiting...", flush=True)
        sys.exit(1)

    # 3. Create Profile Directory
    if not os.path.exists(PROFILE_DIR):
        os.makedirs(PROFILE_DIR)
        print(f"[MAIN] ✓ Created profile directory: {PROFILE_DIR}", flush=True)
    else:
        print(f"[MAIN] ✓ Profile directory exists: {PROFILE_DIR}", flush=True)

    # 4. Write Preferences - enable dev mode and extension logging
    prefs_path = os.path.join(PROFILE_DIR, "user.js")
    print(f"[MAIN] Writing Firefox preferences to: {prefs_path}", flush=True)
    
    prefs_content = f"""
    // Extension settings
    user_pref("xpinstall.signatures.required", false);
    user_pref("extensions.autoDisableScopes", 0);
    user_pref("extensions.enabledScopes", 15);
    
    // Developer mode settings
    user_pref("devtools.chrome.enabled", true);
    user_pref("devtools.debugger.remote-enabled", true);
    user_pref("devtools.debugger.prompt-connection", false);
    user_pref("devtools.toolbox.host", "window");
    user_pref("devtools.toolbox.selectedTool", "webconsole");
    
    // Extension debugging
    user_pref("extensions.sdk.console.logLevel", "all");
    user_pref("browser.dom.window.dump.enabled", true);
    user_pref("javascript.options.showInConsole", true);
    user_pref("extensions.logging.enabled", true);
    user_pref("extensions.webextensions.logging", true);
    
    // Anti-detection
    user_pref("dom.webdriver.enabled", false);
    user_pref("general.appname.override", "Netscape");
    user_pref("general.appversion.override", "5.0 (Windows)");
    user_pref("general.platform.override", "Win32");
    user_pref("general.oscpu.override", "Windows NT 10.0; Win64; x64");
    
    // Console logging
    user_pref("browser.console.showInPanel", true);
    user_pref("browser.startup.homepage", "about:debugging#/runtime/this-firefox");
    """
    
    with open(prefs_path, "w") as f:
        f.write(prefs_content)
    
    print("[MAIN] ✓ Firefox preferences written (including dev mode)", flush=True)
    print(f"[MAIN] Preferences content:\n{prefs_content}", flush=True)

    # 5. Prepare Extension Install File
    extensions_install_dir = os.path.join(PROFILE_DIR, "extensions")
    if not os.path.exists(extensions_install_dir):
        os.makedirs(extensions_install_dir)
        print(f"[MAIN] ✓ Created extensions directory: {extensions_install_dir}", flush=True)
    
    # Create pointer file for the extension
    pointer_file = os.path.join(extensions_install_dir, "kust@claimer")
    with open(pointer_file, "w") as f:
        f.write(EXTENSION_DIR)
    print(f"[MAIN] ✓ Created extension pointer file: {pointer_file}", flush=True)
    print(f"[MAIN]   → Points to: {EXTENSION_DIR}", flush=True)

    # 6. Launch Firefox - with dev tools enabled
    print("\n" + "=" * 60, flush=True)
    print("[MAIN] 🚀 Starting Firefox with Dev Mode...", flush=True)
    print("=" * 60, flush=True)
    
    cmd = [
        "firefox",
        "--display=:0",
        f"--profile={PROFILE_DIR}",
        "--devtools",  # Open with dev tools
        "about:debugging#/runtime/this-firefox"  # Start at extension debugging page
    ]
    
    print(f"[MAIN] Firefox command: {' '.join(cmd)}", flush=True)

    # Launch Firefox in the background
    process = subprocess.Popen(cmd, env={**os.environ, "DISPLAY": ":0"})
    
    print("\n" + "=" * 60, flush=True)
    print("🔥 FIREFOX LAUNCHED SUCCESSFULLY", flush=True)
    print("=" * 60, flush=True)
    print("\n[EXTENSION STATUS]", flush=True)
    print(f"  Extension Path: {EXTENSION_DIR}", flush=True)
    print(f"  Session Token: {SESSION_TOKEN[:20]}...", flush=True)
    print(f"  Username: {USERNAME}", flush=True)
    print(f"  Firefox PID: {process.pid}", flush=True)
    print("\n[INFO] Firefox opened with:", flush=True)
    print("  - DevTools enabled", flush=True)
    print("  - Extension debugging page (about:debugging)", flush=True)
    print("  - Console logging enabled", flush=True)
    print("\n[INFO] Check the extension at:", flush=True)
    print("  about:debugging#/runtime/this-firefox", flush=True)
    print("\n[INFO] To see extension logs:", flush=True)
    print("  1. Go to about:debugging#/runtime/this-firefox", flush=True)
    print("  2. Find 'kust_claimer' extension", flush=True)
    print("  3. Click 'Inspect' to see console logs", flush=True)
    print("=" * 60 + "\n", flush=True)
    
    # Keep the script running with periodic status
    try:
        counter = 0
        while True:
            time.sleep(60)
            counter += 1
            # Check if Firefox is still running
            if process.poll() is not None:
                print(f"[MAIN] ⚠️ Firefox process ended with code: {process.returncode}", flush=True)
                break
            print(f"[MAIN] Bot running for {counter} minute(s) - PID: {process.pid} - Check noVNC console", flush=True)
    except KeyboardInterrupt:
        print("\n[MAIN] Received interrupt signal, killing Firefox...", flush=True)
        process.kill()
        print("[MAIN] ✓ Firefox killed. Exiting.", flush=True)

if __name__ == "__main__":
    main()
