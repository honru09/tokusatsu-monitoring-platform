FROM node:24.19.0-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN --mount=type=cache,id=tokusatsu-pnpm,target=/root/.local/share/pnpm/store \
  --mount=type=cache,id=tokusatsu-pnpm-metadata,target=/root/.cache/pnpm \
  pnpm install --no-runtime --frozen-lockfile --prefer-offline --network-concurrency=6
ENV pnpm_config_runtime_on_fail=error
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY scripts/run-pnpm.mjs scripts/check-toolchain.mjs scripts/
RUN pnpm --filter @tokusatsu/db generate \
  && pnpm --filter @tokusatsu/shared build \
  && pnpm --filter @tokusatsu/db build \
  && pnpm --filter @tokusatsu/api build

FROM node:24.19.0-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV pnpm_config_runtime_on_fail=error
COPY --from=build /app /app
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @tokusatsu/db migrate:deploy && node apps/api/dist/main.js"]
