FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/db packages/db
RUN pnpm --filter @tokusatsu/db generate \
  && pnpm --filter @tokusatsu/shared build \
  && pnpm --filter @tokusatsu/db build \
  && pnpm --filter @tokusatsu/api build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @tokusatsu/db migrate:deploy && node apps/api/dist/main.js"]
