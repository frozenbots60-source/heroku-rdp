FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Add Chromium PPA and set priorities to bypass the Snap version
RUN apt-get update && apt-get install -y software-properties-common gnupg && \
    add-apt-repository -y ppa:canonical-chromium-builds/stage

RUN echo 'Package: * \n\
Pin: release o=LP-PPA-canonical-chromium-builds-stage \n\
Pin-Priority: 1001 \n\
\n\
Package: chromium-browser \n\
Pin: release o=LP-PPA-canonical-chromium-builds-stage \n\
Pin-Priority: 1002' > /etc/apt/preferences.d/chromium-browser

# 2. Install everything (now using the real Chromium from the PPA)
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    chromium-browser \
    && apt-get clean

# 3. Enable the full noVNC interface (with fullscreen button)
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]

