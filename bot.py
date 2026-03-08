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
    print("Setting up extension...", flush=True)

    # 1. Create a clean extension directory
    if os.path.exists(EXTENSION_DIR):
        shutil.rmtree(EXTENSION_DIR)
    os.makedirs(EXTENSION_DIR)

    # 2. Copy manifest.json
    if not os.path.exists(os.path.join(WORKDIR, "manifest.json")):
        print("ERROR: manifest.json not found!", flush=True)
        sys.exit(1)
    
    shutil.copy(os.path.join(WORKDIR, "manifest.json"), os.path.join(EXTENSION_DIR, "manifest.json"))

    # 3. Process the JS script (Inject Token and Username)
    js_path = os.path.join(WORKDIR, "kust_claimer.js")
    if not os.path.exists(js_path):
        print("ERROR: kust_claimer.js not found!", flush=True)
        sys.exit(1)

    with open(js_path, "r") as f:
        script_content = f.read()

    # Replace the default empty token/username with real ones
    # We do this by adding a line at the very top of the script
    inject_config = f"""
    // --- AUTO INJECTED CONFIG ---
    window.KustClaimerConfig = {{ SESSION_TOKEN: '{SESSION_TOKEN}', USERNAME: '{USERNAME}' }};
    // ----------------------------
    """
    
    final_script = inject_config + script_content

    # Save to extension folder
    with open(os.path.join(EXTENSION_DIR, "kust_claimer.js"), "w") as f:
        f.write(final_script)
    
    print("Extension ready.", flush=True)

def main():
    print("Bot started. Waiting for Xvfb...", flush=True)
    time.sleep(5)

    # 1. Setup the extension with the current token
    setup_extension()

    # 2. Create Profile Directory
    if not os.path.exists(PROFILE_DIR):
        os.makedirs(PROFILE_DIR)

    # 3. Write Preferences
    # We write the prefs file before launch.
    prefs_path = os.path.join(PROFILE_DIR, "user.js")
    with open(prefs_path, "w") as f:
        f.write(f"""
        user_pref("xpinstall.signatures.required", false);
        user_pref("extensions.autoDisableScopes", 0);
        user_pref("dom.webdriver.enabled", false);
        user_pref("general.useragent.override", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0");
        """)

    # 4. Prepare Extension Install File
    # We must do this BEFORE starting Firefox so it sees the extension immediately
    extensions_install_dir = os.path.join(PROFILE_DIR, "extensions")
    if not os.path.exists(extensions_install_dir):
        os.makedirs(extensions_install_dir)
    
    # Create pointer file for the extension
    with open(os.path.join(extensions_install_dir, "kust@claimer"), "w") as f:
        f.write(EXTENSION_DIR)

    # 5. Launch Normal Firefox
    print("Starting Normal Firefox...", flush=True)
    
    # Command to run Firefox
    cmd = [
        "firefox",
        "--display=:0",
        f"--profile={PROFILE_DIR}",
        "--no-remote",
        "--new-instance",
        "--disable-sandbox",  # FIX: Required for Heroku/Docker to prevent EPERM crash
        "https://stake.com" 
    ]

    # Launch Firefox in the background
    process = subprocess.Popen(cmd, env={**os.environ, "DISPLAY": ":0"})

    print("=== Firefox launched. Waiting for extension to load... ===", flush=True)
    
    # Keep the script running
    try:
        while True:
            time.sleep(60)
            print("Bot is running (Check noVNC console)...", flush=True)
    except KeyboardInterrupt:
        process.kill()

if __name__ == "__main__":
    main()
