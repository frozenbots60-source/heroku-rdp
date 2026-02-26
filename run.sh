#!/bin/bash

# Ensure the DISPLAY variable is set for any app we run
export DISPLAY=:0

# Start Supervisor (which starts Xvfb, VNC, and the Web UI)
# It uses the config file we created above
/usr/bin/supervisord -c /app/supervisord.conf
