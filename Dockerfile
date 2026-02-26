FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Add the PPA for a non-snap Chromium
RUN apt-get update && apt-get install -y software-properties-common gnupg && \
    add-apt-repository -y ppa:xtradeb/apps

# 2. Force Ubuntu to prefer the PPA version over the Snap-dummy version
RUN echo 'Package: chromium-browser* \n\
Pin: release o=LP-PPA-xtradeb-apps \n\
Pin-Priority: 1001' > /etc/apt/preferences.d/chromium-ppa

# 3. Install Chromium and dependencies
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

# 4. Setup noVNC full interface
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
