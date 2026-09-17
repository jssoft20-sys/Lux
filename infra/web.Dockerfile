FROM node:22-alpine AS build
ARG APP
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/${APP}/package.json apps/${APP}/
RUN pnpm install --frozen-lockfile --filter @somex/${APP}... && pnpm --filter @somex/shared build
COPY apps/${APP} apps/${APP}
# API is reached through nginx on the same origin, so no VITE_API_URL is baked in
RUN cd apps/${APP} && npx vite build

FROM nginx:1.27-alpine
ARG APP
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
