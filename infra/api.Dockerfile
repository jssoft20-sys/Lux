# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable && apk add --no-cache python3 make g++ openssl
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/package.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter @somex/api... --ignore-scripts && pnpm --filter @somex/shared build
COPY apps/api/src apps/api/src
RUN cd apps/api && npx prisma generate && pnpm build && pnpm prune --prod

# ---- runtime ----
FROM node:22-alpine
RUN apk add --no-cache openssl wget && corepack enable
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY infra/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && addgroup -S somex && adduser -S somex -G somex && mkdir -p /app/apps/api/storage && chown -R somex:somex /app
USER somex
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["/entrypoint.sh"]
