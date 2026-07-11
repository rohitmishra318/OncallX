FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/

RUN npm install --workspaces --include-workspace-root

COPY packages/shared/ ./packages/shared/
COPY apps/worker/ ./apps/worker/
COPY prisma/ ./prisma/
COPY tsconfig.base.json ./

RUN npx prisma generate
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/worker

CMD ["node", "apps/worker/dist/index.js"]
