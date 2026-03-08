import time
import os
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from webdriver_manager.firefox import GeckoDriverManager

# ================================
# CONFIGURATION
# ================================
SESSION_TOKEN = os.environ.get('SESSION_TOKEN', '6b4aa7c720e25ec7189a624d3e769979b07d3b3fc9ae65036559f81fb0694bc5e5ecf80bbd82ed7329e32de67887aab2')
USERNAME = "kustxoxo"

# Load the JS script
try:
    with open("kust_claimer.js", "r") as f:
        USER_SCRIPT = f.read()
except FileNotFoundError:
    print("Error: kust_claimer.js not found.")
    exit(1)

def main():
    print("Bot started. Waiting for Xvfb to be ready...")
    time.sleep(5) # Wait for Xvfb to initialize fully

    options = Options()
    
    # Connect to the EXISTING display started by Supervisord
    # This allows you to see the bot working in the noVNC window!
    options.add_argument("--display=:0")
    
    # Use the profile created in Dockerfile to keep login persistence
    options.add_argument("--profile")
    options.add_argument("/tmp/firefox-profile")

    print("Starting Firefox Automation...")
    service = Service(GeckoDriverManager().install())
    driver = webdriver.Firefox(service=service, options=options)

    try:
        # Navigate to Stake
        driver.get("https://stake.com")
        time.sleep(5)

        # Inject the script
        print("Injecting Kust Claimer...")
        driver.execute_script(USER_SCRIPT)
        
        # Set Config
        driver.execute_script(f"window.KustClaimer.setSession('{SESSION_TOKEN}');")
        driver.execute_script(f"window.KustClaimer.setUsername('{USERNAME}');")
        driver.execute_script("window.KustClaimer.init();")

        print("Bot is running. Check noVNC to watch it work.")

        # Keep the script alive
        while True:
            time.sleep(60)
            stats = driver.execute_script("return window.KustClaimer.claimStats;")
            if stats:
                print(f"[Stats] Success: {stats['success']} | Value: ${stats['totalValue']}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        driver.quit()

if __name__ == "__main__":
    main()
