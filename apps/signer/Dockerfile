# Build context: repository root (docker build -f apps/signer/Dockerfile .)
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/signer/package.json apps/signer/
RUN pnpm install --frozen-lockfile --filter @usdt-trx/signer...
COPY packages/shared packages/shared
COPY apps/signer apps/signer
RUN pnpm --filter @usdt-trx/shared build && pnpm --filter @usdt-trx/signer build
# Drop dev dependencies; workspace symlinks stay valid because the whole tree is copied below.
RUN pnpm prune --prod

FROM node:22-alpine
ENV NODE_ENV=production
RUN addgroup -S signer && adduser -S -G signer signer \
 && mkdir -p /audit /secrets && chown signer:signer /audit /secrets
WORKDIR /app
COPY --from=build --chown=signer:signer /repo /app
USER signer
WORKDIR /app/apps/signer
# No outbound network is needed; run in an internal network with only core allowed in.
EXPOSE 3100
CMD ["node", "dist/index.js"]
