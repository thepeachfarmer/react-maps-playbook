# syntax=docker/dockerfile:1
# Multi-stage build: Node builds the static site, nginx serves it.
# The final image holds only nginx + the built files (no node_modules, no
# source, no .env). An optional "server" target serves the same files from a
# small Node server with sign-in (stage 2).

# ---- 1. build -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so this layer is cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build info shown in the About dialog. CI passes real values; local builds
# fall back to these. Vite inlines VITE_* at BUILD time, so changing them on
# a running container does nothing.
ARG APP_VERSION=1.0.dev
ARG COMMIT_SHA=local
ARG BUILT_AT=unknown
ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_COMMIT_SHA=$COMMIT_SHA \
    VITE_BUILT_AT=$BUILT_AT

RUN npm run build

# ---- 2. server (optional) -------------------------------------------------
# The same built files behind a small Node server that can do sign-in (OIDC)
# and refuses to start in production with sign-in off. Build it on purpose:
#   docker build --target server -t react-maps-example:server .
# A plain `docker build .` skips this stage and makes the nginx image below.
# See example/README.md, "Optional sign-in".
FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "server/index.js"]

# ---- 3. serve (the default image) -----------------------------------------
# Docker builds the LAST stage when no --target is given, so this one stays last.
FROM nginx:1.30-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1
