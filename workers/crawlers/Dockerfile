FROM node:24.19.0-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY workers/crawlers/package.json workers/crawlers/package.json
COPY workers/classification/package.json workers/classification/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/product-dictionary/package.json packages/product-dictionary/package.json
COPY services/matching/package.json services/matching/package.json
COPY services/product-intelligence/package.json services/product-intelligence/package.json
RUN --mount=type=cache,id=tokusatsu-pnpm,target=/root/.local/share/pnpm/store \
  --mount=type=cache,id=tokusatsu-pnpm-metadata,target=/root/.cache/pnpm \
  pnpm install --no-runtime --frozen-lockfile --prefer-offline --network-concurrency=6
ENV pnpm_config_runtime_on_fail=error
COPY workers/crawlers workers/crawlers
COPY workers/classification workers/classification
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/product-dictionary packages/product-dictionary
COPY services/matching services/matching
COPY services/product-intelligence services/product-intelligence
COPY scripts/run-pnpm.mjs scripts/check-toolchain.mjs scripts/
RUN pnpm --filter @tokusatsu/db generate \
  && pnpm --filter @tokusatsu/product-dictionary build \
  && pnpm --filter @tokusatsu/matching build \
  && pnpm --filter @tokusatsu/shared build \
  && pnpm --filter @tokusatsu/db build \
  && pnpm --filter @tokusatsu/classification build \
  && pnpm --filter @tokusatsu/product-intelligence build \
  && pnpm --filter @tokusatsu/crawlers build

FROM node:24.19.0-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV pnpm_config_runtime_on_fail=error
COPY --from=build /app /app
CMD ["node", "workers/crawlers/dist/index.js"]
