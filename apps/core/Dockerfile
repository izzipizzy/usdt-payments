# Build context: repository root (docker build -f apps/core/Dockerfile .)
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/core/package.json apps/core/
RUN pnpm install --frozen-lockfile --filter @usdt-trx/core...
COPY packages/shared packages/shared
COPY apps/core apps/core
RUN pnpm --filter @usdt-trx/shared build \
 && pnpm --filter @usdt-trx/core prisma:generate \
 && pnpm --filter @usdt-trx/core build
RUN pnpm prune --prod

FROM node:22-alpine
ENV NODE_ENV=production
RUN addgroup -S core && adduser -S -G core core
WORKDIR /app
COPY --from=build --chown=core:core /repo /app
USER core
WORKDIR /app/apps/core
EXPOSE 3000
# Migrations: docker compose runs `./node_modules/.bin/prisma migrate deploy` in this image.
CMD ["node", "dist/main.js"]
