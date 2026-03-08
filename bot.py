import time
import os
import sys
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

# ================================
# CONFIGURATION
# ================================
SESSION_TOKEN = os.environ.get('SESSION_TOKEN', '6b4aa7c720e25ec7189a624d3e769979b07d3b3fc9ae65036559f81fb0694bc5e5ecf80bbd82ed7329e32de67887aab2')
USERNAME = "kustxoxo"

# Load the JS script
USER_SCRIPT = ""
try:
    with open("kust_claimer.js", "r") as f:
        USER_SCRIPT = f.read()
except FileNotFoundError:
    print("Error: kust_claimer.js not found.")
    sys.exit(1)

def main():
    print("Bot started. Waiting for Xvfb...", flush=True)
    time.sleep(5) 

    options = Options()
    
    # Connect to the Display
    options.add_argument("--display=:0")
    
    # CRITICAL FIXES FOR HEROKU/DOCKER:
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    
    # ==========================================
    # STEALTH CONFIGURATION (Fixes Captcha Loop)
    # ==========================================
    # 1. Hide the 'webdriver' flag (Most important)
    options.set_preference("dom.webdriver.enabled", False)
    
    # 2. Set a real User-Agent (Prevents detection as a bot browser)
    options.set_preference("general.useragent.override", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0")
    
    # 3. Prevent popup detection
    options.set_preference("dom.disable_open_during_load", False)
    # ==========================================

    # Use the geckodriver installed in Dockerfile
    service = Service('/usr/local/bin/geckodriver')
    
    driver = None
    try:
        print("Starting Firefox...", flush=True)
        driver = webdriver.Firefox(service=service, options=options)
        
        # Extra Stealth: Remove the WebDriver property from the window object immediately
        # This is a backup in case the preference doesn't work fully
        driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        print("Navigating to Stake...", flush=True)
        driver.get("https://stake.com")
        time.sleep(5)

        print("Injecting Kust Claimer...", flush=True)
        driver.execute_script(USER_SCRIPT)
        
        print("Setting configuration...", flush=True)
        driver.execute_script(f"window.KustClaimer.setSession('{SESSION_TOKEN}');")
        driver.execute_script(f"window.KustClaimer.setUsername('{USERNAME}');")
        driver.execute_script("window.KustClaimer.init();")

        print("=== Bot is running. Check noVNC to watch it. ===", flush=True)

        # Keep alive loop
        while True:
            time.sleep(60)
            try:
                stats = driver.execute_script("return window.KustClaimer.claimStats;")
                if stats:
                    print(f"[Stats] Success: {stats['success']} | Value: ${stats['totalValue']}", flush=True)
            except:
                print("Stats check failed, browser might have closed.", flush=True)
                break

    except Exception as e:
        print(f"CRITICAL ERROR: {e}", flush=True)
    finally:
        if driver:
            driver.quit()

if __name__ == "__main__":
    main()
