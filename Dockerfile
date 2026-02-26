FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install prerequisites and add the Mozilla PPA for the non-snap Firefox
RUN apt-get update && apt-get install -y software-properties-common gnupg && \
    add-apt-repository -y ppa:mozillateam/ppa

# 2. Tell Ubuntu to prefer the PPA version over the Snap-dummy version
RUN echo 'Package: * \n\
Pin: release o=LP-PPA-mozillateam \n\
Pin-Priority: 1001 \n\
\n\
Package: firefox \n\
Pin: release o=LP-PPA-mozillateam \n\
Pin-Priority: 1002' > /etc/apt/preferences.d/mozilla-firefox

# 3. Now install everything including the real Firefox
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    firefox \
    && apt-get clean

# 4. Setup noVNC full interface
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
