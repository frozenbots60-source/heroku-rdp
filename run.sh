#!/bin/bash

# The extension code is already in the repo/container at this point.
# If you need to move it to a specific profile location before launch, 
# you can add that logic here, otherwise, we head straight to services.

# 1. Start the services
export DISPLAY=:0
/usr/bin/supervisord -c /app/supervisord.conf
