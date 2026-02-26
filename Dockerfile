FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install basics
RUN apt-get update && apt-get install -y software-properties-common gnupg curl

# 2. Add the Chromium PPA
RUN add-apt-repository -y ppa:xtradeb/apps

# 3. FORCE Pinning (The "Firefox way")
# This tells Ubuntu: "Ignore the official version, only use the PPA version"
RUN echo 'Package: * \n\
Pin: release o=LP-PPA-xtradeb-apps \n\
Pin-Priority: 1001' > /etc/apt/preferences.d/xtradeb-ppa

# 4. Install Chromium and the rest of your stack
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    chromium-browser \
    && apt-get clean

# 5. Setup noVNC
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Ensure scripts are executable and /tmp is accessible
RUN chmod +x /app/run.sh && chmod -R 777 /tmp

CMD ["/app/run.sh"]
