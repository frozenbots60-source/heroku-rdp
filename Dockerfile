FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:0

# Install the "Desktop" environment and Firefox
RUN apt-get update && apt-get install -y \
    xvfb fluxbox x11vnc novnc websockify \
    python3 supervisor xterm firefox \
    && apt-get clean

# Setup noVNC index
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .
RUN chmod +x /app/run.sh

# The port is handled by Heroku, we just need to start the script
CMD ["/app/run.sh"]
