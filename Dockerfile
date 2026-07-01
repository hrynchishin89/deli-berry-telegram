FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org/

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
