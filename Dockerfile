FROM ubuntu:22.04

# Prevent interactive prompts and Python bytecode generation to speed things up
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 1. ONE MASSIVE LAYER: Install, Download, Configure, and Clean up
# Squashing this into one layer makes Docker and Heroku process it much faster.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    bzip2 \
    xz-utils \
    ca-certificates \
    xvfb \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    supervisor \
    python3 \
    python3-pip \
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
    && rm -rf /var/lib/apt/lists/* \
    && curl -L "https://download.mozilla.org/?product=firefox-devedition-latest-ssl&os=linux64&lang=en-US" -o /tmp/firefox-dev.tar.xz \
    && tar -xf /tmp/firefox-dev.tar.xz -C /opt \
    && ln -s /opt/firefox/firefox /usr/bin/firefox \
    && wget -q "https://github.com/mozilla/geckodriver/releases/download/v0.34.0/geckodriver-v0.34.0-linux64.tar.gz" -O /tmp/geckodriver.tar.gz \
    && tar -xzf /tmp/geckodriver.tar.gz -C /usr/local/bin \
    && rm -f /tmp/firefox-dev.tar.xz /tmp/geckodriver.tar.gz \
    && mkdir -p /opt/firefox/browser/defaults/preferences/ \
    && echo 'pref("general.config.filename", "mozilla.cfg");' > /opt/firefox/browser/defaults/preferences/autoconfig.js \
    && echo 'pref("general.config.obscure_value", 0);' >> /opt/firefox/browser/defaults/preferences/autoconfig.js \
    && echo '//' > /opt/firefox/mozilla.cfg \
    && echo 'lockPref("xpinstall.signatures.required", false);' >> /opt/firefox/mozilla.cfg \
    && echo 'lockPref("extensions.checkCompatibility.nightly", false);' >> /opt/firefox/mozilla.cfg \
    && chmod 1777 /tmp \
    && ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# 2. Install Python Libraries
# Added --no-cache-dir so pip doesn't save backup files, saving more space
RUN pip3 install --no-cache-dir selenium

WORKDIR /app
COPY . .

# Fix permissions for the startup script
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
