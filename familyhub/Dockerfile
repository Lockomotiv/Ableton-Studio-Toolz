# FamilyHub-Server (läuft auf Raspberry Pi 4/5 und jedem anderen Docker-Host)
FROM node:22-alpine
WORKDIR /app
COPY web ./web
COPY server ./server
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/server.js"]
