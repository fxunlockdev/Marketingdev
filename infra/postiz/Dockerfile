FROM node:22-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
LABEL org.opencontainers.image.source="https://github.com/gitroomhq/postiz-app" \
      org.opencontainers.image.revision="651876e24317c2d8e717262cf98267ec6f699180"
USER root
RUN apt-get update && apt-get install -y --no-install-recommends g++ make python3 openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.6.1
WORKDIR /app
# Context is produced only by the exact-commit export script, never the working tree.
COPY . /app
ENV NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm rebuild bcrypt \
    && pnpm exec prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
RUN pnpm run build:backend && pnpm run build:orchestrator
RUN mkdir -p /uploads && chown node:node /uploads
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/backend
# Orchestrator uses the same image with its own explicit start command.
CMD ["node", "--experimental-require-module", "dist/apps/backend/src/main.js"]
