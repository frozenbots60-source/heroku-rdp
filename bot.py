#!/usr/bin/env python3
"""
Integrated Bot Startup Script
Launches both the Hardware Click Server and Firefox with the extension.

This solution enables Cloudflare Turnstile bypass in XRDP environments by:
1. JS extension detects captcha and gets screen coordinates
2. Extension sends coordinates to local Python WebSocket server
3. Python server uses xdotool to perform hardware-level X11 clicks
4. These clicks appear as real hardware input to applications under XRDP
"""

import time
import os
import subprocess
import sys
import shutil
import json
import zipfile
import signal
import threading
import logging

# ================================
# CONFIGURATION
# ================================
WORKDIR = "/app"
EXTENSION_DIR = os.path.join(WORKDIR, "claimer")
PROFILE_DIR = "/tmp/firefox-profile"
HARDWARE_CLICK_SERVER_PORT = 8765

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("BotStarter")


class HardwareClickServerManager:
    """Manages the hardware click server as a subprocess."""
    
    def __init__(self, port: int = 8765):
        self.port = port
        self.process = None
        self.script_path = os.path.join(os.path.dirname(__file__), "hardware_clicker.py")
    
    def start(self):
        """Start the hardware click server."""
        logger.info("=" * 60)
        logger.info("[HARDWARE SERVER] Starting Hardware Click Server...")
        logger.info("=" * 60)
        
        if not os.path.exists(self.script_path):
            logger.error(f"❌ Hardware clicker script not found: {self.script_path}")
            return False
        
        # Start server as subprocess
        self.process = subprocess.Popen(
            [sys.executable, self.script_path, "--port", str(self.port), "--display", ":0"],
            env={**os.environ, "DISPLAY": ":0"},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            text=True
        )
        
        # Start thread to log output
        def log_output():
            for line in iter(self.process.stdout.readline, ''):
                if line:
                    print(line, end='')
        
        threading.Thread(target=log_output, daemon=True).start()
        
        # Give it time to start
        time.sleep(2)
        
        if self.process.poll() is None:
            logger.info(f"✓ Hardware Click Server started on port {self.port}")
            return True
        else:
            logger.error("❌ Hardware Click Server failed to start")
            return False
    
    def stop(self):
        """Stop the hardware click server."""
        if self.process and self.process.poll() is None:
            logger.info("Stopping Hardware Click Server...")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            logger.info("Hardware Click Server stopped.")


def prepare_sideload_extension():
    """Zips the claimer folder and places it in the profile's extension directory."""
    logger.info("=" * 60)
    logger.info("[EXTENSION SETUP] Preparing extension for sideloading...")
    logger.info("=" * 60)

    if not os.path.exists(EXTENSION_DIR):
        logger.error(f"❌ ERROR: Directory {EXTENSION_DIR} not found!")
        sys.exit(1)

    manifest_path = os.path.join(EXTENSION_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        logger.error(f"❌ ERROR: manifest.json not found in {EXTENSION_DIR}!")
        sys.exit(1)

    # 1. Get the extension ID from manifest
    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        
        # Sideloading requires an ID. Fallback if missing.
        ext_id = manifest.get("browser_specific_settings", {}).get("gecko", {}).get("id")
        if not ext_id:
            ext_id = "copilot-bridge-hardware@local.host"
            logger.warning(f"⚠️ No Gecko ID found. Using fallback: {ext_id}")
    except Exception as e:
        logger.error(f"❌ ERROR reading manifest: {e}")
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

    logger.info(f"✓ Extension packed and sideloaded: {ext_id}.xpi")
    logger.info("=" * 60)


def verify_xdotool():
    """Verify xdotool is installed."""
    logger.info("[SYSTEM] Verifying xdotool installation...")
    
    try:
        result = subprocess.run(
            ["xdotool", "version"],
            capture_output=True,
            text=True,
            env={**os.environ, "DISPLAY": ":0"}
        )
        
        if result.returncode == 0:
            logger.info(f"✓ xdotool available: {result.stdout.strip()}")
            return True
        else:
            logger.error("❌ xdotool not working properly")
            return False
    except FileNotFoundError:
        logger.error("❌ xdotool not found! Install with: apt-get install xdotool")
        return False


def create_firefox_preferences():
    """Create Firefox preference file."""
    prefs_path = os.path.join(PROFILE_DIR, "user.js")
    logger.info("[MAIN] Writing Firefox preferences...")
    
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
    user_pref("browser.startup.homepage", "https://copilot.microsoft.com/");
    user_pref("browser.startup.page", 1);
    user_pref("browser.startup.homepage_override.mstone", "ignore");
    
    // Allow local WebSocket connections (for hardware click server)
    user_pref("network.websocket.allowInsecureFromHTTPS", true);
    """
    
    with open(prefs_path, "w") as f:
        f.write(prefs_content)
    
    logger.info("[MAIN] ✓ Preferences written.")


def main():
    logger.info("\n" + "=" * 60)
    logger.info("🤖 BOT STARTING WITH HARDWARE CAPTCHA SUPPORT")
    logger.info("=" * 60)
    logger.info(f"Working Directory: {WORKDIR}")
    logger.info(f"Profile Directory: {PROFILE_DIR}")
    logger.info(f"Hardware Click Server Port: {HARDWARE_CLICK_SERVER_PORT}")
    logger.info("=" * 60 + "\n")
    
    # 0. Verify xdotool
    if not verify_xdotool():
        logger.warning("⚠️ xdotool not available, hardware clicks may not work")
    
    # 1. Wait for Xvfb
    logger.info("[MAIN] Waiting for Xvfb...")
    time.sleep(5)
    logger.info("[MAIN] ✓ Xvfb should be ready")

    # 2. Start Hardware Click Server FIRST
    hardware_server = HardwareClickServerManager(port=HARDWARE_CLICK_SERVER_PORT)
    if not hardware_server.start():
        logger.warning("⚠️ Hardware Click Server could not start, continuing without it...")

    # 3. Create Clean Profile Directory
    if os.path.exists(PROFILE_DIR):
        shutil.rmtree(PROFILE_DIR)
    os.makedirs(PROFILE_DIR)

    # 4. Prepare and Sideload Extension
    prepare_sideload_extension()

    # 5. Write Firefox Preferences
    create_firefox_preferences()

    # 6. Launch Firefox
    logger.info("\n" + "=" * 60)
    logger.info("[MAIN] 🚀 Starting Firefox...")
    logger.info("=" * 60)
    
    cmd = [
        "firefox",
        "--display=:0",
        f"--profile={PROFILE_DIR}",
        "--no-remote",
        "--no-sandbox"
    ]
    
    logger.info(f"[MAIN] Firefox command: {' '.join(cmd)}")

    firefox_process = subprocess.Popen(cmd, env={**os.environ, "DISPLAY": ":0"})
    
    logger.info("\n" + "=" * 60)
    logger.info("🔥 FIREFOX LAUNCHED SUCCESSFULLY")
    logger.info("=" * 60)
    logger.info("\n[STATUS]")
    logger.info(f"  Extension Loaded from: {EXTENSION_DIR}")
    logger.info(f"  Hardware Click Server: ws://127.0.0.1:{HARDWARE_CLICK_SERVER_PORT}")
    logger.info("  Target URL: https://copilot.microsoft.com/")
    logger.info("=" * 60 + "\n")
    
    # Signal handler for cleanup
    def signal_handler(signum, frame):
        logger.info("\n[MAIN] Received interrupt signal...")
        hardware_server.stop()
        firefox_process.kill()
        logger.info("[MAIN] ✓ Cleanup complete. Exiting.")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        counter = 0
        while True:
            time.sleep(60)
            counter += 1
            
            # Check Firefox
            if firefox_process.poll() is not None:
                logger.warning(f"[MAIN] ⚠️ Firefox process ended with code: {firefox_process.returncode}")
                break
            
            # Check hardware server
            if hardware_server.process and hardware_server.process.poll() is not None:
                logger.warning("[MAIN] ⚠️ Hardware Click Server died, restarting...")
                hardware_server.start()
            
            logger.info(f"[MAIN] Bot running for {counter} minute(s) - Firefox PID: {firefox_process.pid}")
            
    except KeyboardInterrupt:
        signal_handler(None, None)


if __name__ == "__main__":
    main()
