# syntax=docker/dockerfile:1

# Node 24 runs the TypeScript sources directly (type stripping), so there is no build step: install the worker's
# production dependencies in the workspace layout, then add the sources.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@betting/worker..."

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HEARTBEAT_PATH=/data/heartbeat \
    TZ=UTC
WORKDIR /app
COPY --from=deps --chown=node:node /app ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps/worker ./apps/worker
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 CMD ["node", "apps/worker/src/healthcheck.ts"]
CMD ["node", "apps/worker/src/main.ts"]
