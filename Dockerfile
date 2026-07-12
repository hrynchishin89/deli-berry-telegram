FROM node:20-alpine

WORKDIR /app

# Use the public npm registry and install the exact locked dependency tree.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && node -e "require('express'); require('helmet'); require('pg'); require('qrcode'); console.log('Production dependencies OK')" \
    && npm cache clean --force

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
