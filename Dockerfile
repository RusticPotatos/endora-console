# Endora Console: the console's files and a small Node server, no dependencies.
FROM node:22.12.0-alpine
WORKDIR /app
COPY package.json NOTICE LICENSE ./
COPY contract ./contract
COPY server ./server
COPY web ./web
ARG CONSOLE_BUILD=dev
ENV NODE_ENV=production PORT=8080 CONSOLE_BUILD=${CONSOLE_BUILD}
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["node", "server/health.mjs"]
CMD ["node", "server/main.mjs"]
