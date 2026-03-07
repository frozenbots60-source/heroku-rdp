#!/bin/bash

# Ensure the display environment variable is set for the X server
export DISPLAY=:0

# Start supervisord to manage all processes
# (The extension setup logic is now handled internally or via the local repo files)
/usr/bin/supervisord -c /app/supervisord.conf
