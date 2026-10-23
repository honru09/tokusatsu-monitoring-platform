FROM debian:bookworm-slim
COPY --from=node:24.19.0-alpine /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY infrastructure/operations/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update && apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends squid ca-certificates && rm -rf /var/lib/apt/lists/*
COPY infrastructure/operations/squid.conf /etc/squid/squid.conf
USER proxy
CMD ["squid","-N","-f","/etc/squid/squid.conf"]
