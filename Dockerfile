FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Basics & PPA Setup
RUN apt-get update && apt-get install -y software-properties-common gnupg curl
RUN add-apt-repository -y ppa:xtradeb/apps

# 2. Force Pinning (The "Firefox way")
RUN echo 'Package: * \n\
Pin: release o=LP-PPA-xtradeb-apps \n\
Pin-Priority: 1001' > /etc/apt/preferences.d/xtradeb-ppa

# 3. Install Chromium + essential libs for headless/containers
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    chromium-browser \
    libnss3 \
    libgbm1 \
    libasound2 \
    && apt-get clean

# 4. Setup noVNC
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

RUN chmod +x /app/run.sh && chmod -R 777 /tmp

CMD ["/app/run.sh"]
