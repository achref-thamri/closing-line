# syntax=docker/dockerfile:1

# Next.js needs a build; its standalone output keeps the runtime image small.
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@closing-line/web..."
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/db ./packages/db
COPY apps/web ./apps/web
RUN pnpm --filter @closing-line/web build

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://localhost:3000').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
