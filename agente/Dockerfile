# Backend Iara (Node 22) — LC SDR Agente
FROM node:22-alpine

# build tools para better-sqlite3 (tem binding nativo)
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Instala deps primeiro (aproveita cache)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --include=optional || npm install

# Copia código
COPY src ./src
COPY scripts ./scripts

# Dir de dados (SQLite) + logs — persistem via volume
RUN mkdir -p /app/data /app/logs
VOLUME ["/app/data"]

EXPOSE 3333

# Aplica schema e sobe
CMD ["sh", "-c", "node src/db/migrate.js && node src/index.js"]
