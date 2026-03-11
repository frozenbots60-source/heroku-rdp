import time
import os
import subprocess
import sys
import shutil
import json
import zipfile
import re

# ================================
# CONFIGURATION
# ================================
WORKDIR = "/app"
EXTENSION_DIR = os.path.join(WORKDIR, "claimer")
PROFILE_DIR = "/tmp/firefox-profile"

def prepare_sideload_extension():
    """Zips the claimer folder and places it in the profile's extension directory."""
    print("=" * 60, flush=True)
    print("[EXTENSION SETUP] Preparing extension for sideloading...", flush=True)
    print("=" * 60, flush=True)

    if not os.path.exists(EXTENSION_DIR):
        print(f"[EXTENSION SETUP] ❌ ERROR: Directory {EXTENSION_DIR} not found!", flush=True)
        sys.exit(1)

    # --- START: SESSION TOKEN INJECTION ---
    claim_js_path = os.path.join(EXTENSION_DIR, "claim.js")
    if os.path.exists(claim_js_path):
        # Get token from environment variable, default to empty string if not found
        session_token = os.environ.get("SESSION_TOKEN", "")
        
        print(f"[EXTENSION SETUP] Injecting session token into claim.js...", flush=True)
        
        with open(claim_js_path, "r") as f:
            content = f.read()
        
        # Regex to find the specific constant assignment and replace the value
        # Pattern matches: const HARDCODED_SESSION_TOKEN = '...';
        pattern = r"const HARDCODED_SESSION_TOKEN = '.*?';"
        replacement = f"const HARDCODED_SESSION_TOKEN = '{session_token}';"
        new_content = re.sub(pattern, replacement, content)
        
        with open(claim_js_path, "w") as f:
            f.write(new_content)
            
        print(f"[EXTENSION SETUP] ✓ Session token injected.", flush=True)
    else:
        print(f"[EXTENSION SETUP] ⚠️ claim.js not found at {claim_js_path}. Skipping token injection.", flush=True)
    # --- END: SESSION TOKEN INJECTION ---

    manifest_path = os.path.join(EXTENSION_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"[EXTENSION SETUP] ❌ ERROR: manifest.json not found in {EXTENSION_DIR}!", flush=True)
        sys.exit(1)

    # 1. Get the extension ID from manifest
    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        
        # Sideloading requires an ID. Fallback if missing.
        ext_id = manifest.get("browser_specific_settings", {}).get("gecko", {}).get("id")
        if not ext_id:
            ext_id = "kust-claimer@local.host"
            print(f"[EXTENSION SETUP] ⚠️ No Gecko ID found. Using fallback: {ext_id}", flush=True)
    except Exception as e:
        print(f"[EXTENSION SETUP] ❌ ERROR reading manifest: {e}", flush=True)
        sys.exit(1)

    # 2. Create the extensions directory inside the profile
    ext_dest_path = os.path.join(PROFILE_DIR, "extensions")
    os.makedirs(ext_dest_path, exist_ok=True)

    # 3. Zip the folder into {id}.xpi
    xpi_file = os.path.join(ext_dest_path, f"{ext_id}.xpi")
    
    with zipfile.ZipFile(xpi_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            for file in files:
                file_path = os.path.join(root, file)
                # Create relative path for the zip
                arcname = os.path.relpath(file_path, EXTENSION_DIR)
                zipf.write(file_path, arcname)

    print(f"[EXTENSION SETUP] ✓ Extension packed and sideloaded: {ext_id}.xpi", flush=True)
    print("=" * 60, flush=True)

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

    # 1. Create Clean Profile Directory
    if os.path.exists(PROFILE_DIR):
        shutil.rmtree(PROFILE_DIR)
    os.makedirs(PROFILE_DIR)

    # 2. Prepare and Sideload Extension
    prepare_sideload_extension()

    # 3. Write Preferences (CRITICAL for auto-enabling sideloaded extensions)
    prefs_path = os.path.join(PROFILE_DIR, "user.js")
    print(f"[MAIN] Writing Firefox preferences...", flush=True)
    
    prefs_content = """
    // Extension logic
    user_pref("xpinstall.signatures.required", false);
    user_pref("extensions.autoDisableScopes", 0); // Auto-enable sideloaded addons
    user_pref("extensions.enabledScopes", 15);
    user_pref("extensions.startupScanScopes", 15);
    
    // Anti-detection
    user_pref("dom.webdriver.enabled", false);
    user_pref("usePrivilegedMozillaProcess", true);
    
    // Developer mode / Debugging
    user_pref("devtools.chrome.enabled", true);
    user_pref("extensions.logging.enabled", true);
    user_pref("browser.dom.window.dump.enabled", true);
    
    // STARTUP
    user_pref("browser.startup.homepage", "https://stake1017.com/");
    user_pref("browser.startup.page", 1);
    user_pref("browser.startup.homepage_override.mstone", "ignore");
    """
    
    with open(prefs_path, "w") as f:
        f.write(prefs_content)
    print("[MAIN] ✓ Preferences written.", flush=True)

    # 4. Launch Firefox
    print("\n" + "=" * 60, flush=True)
    print("[MAIN] 🚀 Starting Firefox...", flush=True)
    print("=" * 60, flush=True)
    
    cmd = [
        "firefox",
        "--display=:0",
        f"--profile={PROFILE_DIR}",
        "--no-remote",
        "--no-sandbox" 
    ]
    
    print(f"[MAIN] Firefox command: {' '.join(cmd)}", flush=True)

    # Pass the DISPLAY environment variable so it renders on your VNC screen
    process = subprocess.Popen(cmd, env={**os.environ, "DISPLAY": ":0"})
    
    print("\n" + "=" * 60, flush=True)
    print("🔥 FIREFOX LAUNCHED SUCCESSFULLY", flush=True)
    print("=" * 60, flush=True)
    print("\n[STATUS]", flush=True)
    print(f"  Extension Loaded from: {EXTENSION_DIR}", flush=True)
    print("  Target URL: https://stake1017.com/")
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
