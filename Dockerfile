FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Chromium and the necessary display/VNC tools
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    chromium-browser \
    libgbm1 \
    && apt-get clean

# Setup noVNC full interface with the side-bar menu
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions for Heroku's restricted environment
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
