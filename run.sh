#!/bin/bash

# 1. Create the directory where the extension will live
mkdir -p /tmp/my-extension

# 2. Download the extension zip file from the provided URL
wget -qO /tmp/extension.zip https://kustbots.github.io/file/claimer-v3.1.zip

# 3. Extract the contents of the zip file into the target folder
unzip -q -o /tmp/extension.zip -d /tmp/my-extension

# 4. Clean up the downloaded zip file to keep the container clean
rm /tmp/extension.zip

# 5. Start the original services
export DISPLAY=:0
/usr/bin/supervisord -c /app/supervisord.conf
