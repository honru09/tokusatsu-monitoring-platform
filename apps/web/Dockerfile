FROM node:24.19.0-alpine AS build
RUN corepack enable
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_STANDALONE=true
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=tokusatsu-pnpm,target=/root/.local/share/pnpm/store \
  --mount=type=cache,id=tokusatsu-pnpm-metadata,target=/root/.cache/pnpm \
  pnpm install --no-runtime --frozen-lockfile --prefer-offline --network-concurrency=6
ENV pnpm_config_runtime_on_fail=error
COPY apps/web apps/web
RUN pnpm --filter @tokusatsu/web build

FROM node:24.19.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
