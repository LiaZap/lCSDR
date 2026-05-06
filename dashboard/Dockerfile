# Dashboard (Vite dev server) — LC SDR
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

# Vite precisa do --host 0.0.0.0 pra expor pra fora do container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
