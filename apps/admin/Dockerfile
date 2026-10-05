# ---- build stage --------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10 --activate

# Workspace manifests first for a cacheable install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @usdt-trx/admin...

# Sources: shared lib must be built before the admin app (workspace dep on dist/).
COPY packages/shared packages/shared
COPY apps/admin apps/admin
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm --filter @usdt-trx/shared build && pnpm --filter @usdt-trx/admin build

# ---- runtime stage ------------------------------------------------------
FROM nginx:alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
