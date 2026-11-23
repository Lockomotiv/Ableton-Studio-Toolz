# FamilyHub-Server (Raspberry Pi 4/5 und jeder andere Docker-Host, arm64 & amd64)
FROM node:24-alpine
WORKDIR /app
COPY web ./web
COPY server ./server
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web
# Datenordner gehört dem App-Benutzer (auch ohne eingebundenen Ordner beschreibbar)
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/server.js"]
