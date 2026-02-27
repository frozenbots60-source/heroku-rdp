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
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc-s1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libgbm1 \
    ca-certificates \
    lsb-release \
    && apt-get clean

# 2b. Create a persistent, writable profile directory for Chrome so extensions can be installed/managed
RUN mkdir -p /tmp/chrome-user-data && chmod -R 777 /tmp/chrome-user-data

# 3. Enable the full noVNC interface (with fullscreen button)
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
