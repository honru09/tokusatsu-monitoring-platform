FROM node:24.19.0-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/operations-gateway/package.json apps/operations-gateway/package.json
RUN pnpm install --no-runtime --frozen-lockfile
COPY apps/operations-gateway apps/operations-gateway
RUN pnpm --filter @tokusatsu/operations-gateway build
FROM node:24.19.0-alpine
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/operations-gateway
USER node
EXPOSE 8080
CMD ["node","server.mjs"]
