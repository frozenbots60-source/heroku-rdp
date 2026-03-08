FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Add Mozilla PPA and set priorities to bypass Snap
RUN apt-get update && apt-get install -y software-properties-common gnupg wget ca-certificates && \
    add-apt-repository -y ppa:mozillateam/ppa

RUN echo 'Package: firefox* \n\
Pin: release o=LP-PPA-mozillateam \n\
Pin-Priority: 1001' > /etc/apt/preferences.d/mozilla-firefox

# 2. Install dependencies (Swapped Chrome for Firefox)
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    firefox \
    fonts-liberation \
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
    unzip \
    && apt-get clean

# 2b. Set /tmp to be globally writable (Sticky Bit) 
# This allows the non-root user to create the firefox-profile at runtime
RUN chmod 1777 /tmp

# 3. Enable the full noVNC interface
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions for the startup script
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
