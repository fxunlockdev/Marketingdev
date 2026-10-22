FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build
WORKDIR /opt/desvio
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY apps/api/src ./apps/api/src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb
WORKDIR /opt/desvio
ENV NODE_ENV=production LISTEN_HOST=::
COPY --from=build --chown=node:node /opt/desvio/node_modules ./node_modules
COPY --from=build --chown=node:node /opt/desvio/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/bootstrap-database.mjs scripts/migrate.mjs ./scripts/
COPY --chown=node:node database/migrations ./database/migrations
USER node
# Default API. A separate, one-shot bootstrap service uses
# node scripts/bootstrap-database.mjs; only it receives migration credentials.
# A private provisioner service uses node dist/provisioner-main.js and its own secrets.
CMD ["node","dist/main.js"]
