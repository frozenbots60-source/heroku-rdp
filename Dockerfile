FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Add Mozilla PPA and set priorities to bypass the Snap version
RUN apt-get update && apt-get install -y software-properties-common gnupg && \
    add-apt-repository -y ppa:mozillateam/ppa

RUN echo 'Package: * \n\
Pin: release o=LP-PPA-mozillateam \n\
Pin-Priority: 1001 \n\
\n\
Package: firefox \n\
Pin: release o=LP-PPA-mozillateam \n\
Pin-Priority: 1002' > /etc/apt/preferences.d/mozilla-firefox

# 2. Install everything (now using the real Firefox from the PPA)
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    firefox \
    && apt-get clean

# 3. Enable the full noVNC interface (with fullscreen button)
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

WORKDIR /app
COPY . .

# Fix permissions
RUN chmod -R 777 /tmp
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
