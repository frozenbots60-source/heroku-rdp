#!/bin/bash
export DISPLAY=:0
/usr/bin/supervisord -c /app/supervisord.conf
