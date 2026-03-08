#!/bin/bash
# Clean up any old locks that might be causing the "Inaccessible" error
rm -rf /tmp/firefox-profile/lock
rm -rf /tmp/firefox-profile/.parentlock

# Ensure the profile dir is ready for the current runtime user
mkdir -p /tmp/firefox-profile

# Start supervisord
/usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
