FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

# targets.json must be mounted at runtime — never baked in
VOLUME ["/app/targets.json"]

ENV NODE_ENV=production

CMD ["npx", "ts-node", "src/index.ts"]
