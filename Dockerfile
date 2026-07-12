FROM node:20-alpine

WORKDIR /app

# Install the locked production dependency tree from the public npm registry.
# This does not depend on a hidden .npmrc file, which browsers may skip during upload.
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmjs.org/ \
    && npm ci --omit=dev --no-audit --no-fund \
    && node -e "require('express'); require('helmet'); require('pg'); require('qrcode'); console.log('Production dependencies OK')" \
    && npm cache clean --force

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
