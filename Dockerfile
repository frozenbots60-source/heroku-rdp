FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Add Google Chrome repo and set priorities to bypass Snap
RUN apt-get update && apt-get install -y software-properties-common gnupg wget ca-certificates && \
    mkdir -p /usr/share/keyrings && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux-signing-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

RUN echo 'Package: * \n\
Pin: origin dl.google.com \n\
Pin-Priority: 1001 \n\
\n\
Package: google-chrome-stable \n\
Pin: origin dl.google.com \n\
Pin-Priority: 1002' > /etc/apt/preferences.d/google-chrome

# 2. Install everything (now using Google Chrome stable from Google's repo)
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    google-chrome-stable \
    && apt-get clean

# 3. Enable the full noVNC interface (with fullscreen button)
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
