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
    options.add_argument("--display=:0")
    options.add_argument("--profile")
    options.add_argument("/tmp/firefox-profile")
    
    # Use the geckodriver installed via apt in Dockerfile
    service = Service('/usr/bin/geckodriver')
    
    driver = None
    try:
        print("Starting Firefox...", flush=True)
        driver = webdriver.Firefox(service=service, options=options)
        
        print("Navigating to Stake...", flush=True)
        driver.get("https://stake.com")
        time.sleep(5)

        print("Injecting Kust Claimer...", flush=True)
        driver.execute_script(USER_SCRIPT)
        
        print("Setting configuration...", flush=True)
        driver.execute_script(f"window.KustClaimer.setSession('{SESSION_TOKEN}');")
        driver.execute_script(f"window.KustClaimer.setUsername('{USERNAME}');")
        driver.execute_script("window.KustClaimer.init();")

        print("Bot is running.", flush=True)

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
