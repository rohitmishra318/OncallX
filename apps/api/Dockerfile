FROM node:20-alpine AS base
WORKDIR /app

# Copy workspace manifests
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/

# Install all workspace deps
RUN npm install --workspaces --include-workspace-root

# Copy source
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/
COPY prisma/ ./prisma/
COPY tsconfig.base.json ./

# Generate Prisma client
RUN npx prisma generate

# Build shared then api
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/api

EXPOSE 4000

# Run migrations + start in one CMD so the DB is ready on first boot
CMD ["sh", "-c", "npx prisma migrate deploy && node apps/api/dist/index.js"]
