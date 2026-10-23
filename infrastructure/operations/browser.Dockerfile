FROM debian:bookworm-slim
COPY --from=node:24.19.0-alpine /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY infrastructure/operations/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update && apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends \
    chromium xvfb x11vnc openbox dbus-x11 fonts-noto-cjk fonts-noto-color-emoji \
    ca-certificates tini x11-xserver-utils x11-utils curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home browser
RUN apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update && apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends \
    wmctrl python3 python3-websocket && rm -rf /var/lib/apt/lists/*
RUN apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update && apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends \
    chromium-l10n locales && localedef -i zh_CN -f UTF-8 zh_CN.UTF-8 && rm -rf /var/lib/apt/lists/*
COPY infrastructure/operations/configure-language.py /usr/local/bin/configure-language.py
COPY infrastructure/operations/browser-start.sh /usr/local/bin/browser-start
COPY infrastructure/operations/browser-control.py /usr/local/bin/browser-control.py
COPY infrastructure/operations/page-assistant.js /usr/local/bin/page-assistant.js
COPY infrastructure/operations/media-bridge.py /usr/local/bin/media-bridge.py
RUN chmod 755 /usr/local/bin/browser-start
USER 1000:1000
ENV HOME=/profile DISPLAY=:99 LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 LANGUAGE=zh_CN:zh TZ=Asia/Tokyo
ENTRYPOINT ["/usr/bin/tini","--","/usr/local/bin/browser-start"]
