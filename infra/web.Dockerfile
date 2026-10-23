FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build
WORKDIR /opt/desvio
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web ./apps/web
# Shared browser-safe calendar utilities and type-only design dependency graph.
# This is build-stage source only; the final image receives traced web output.
COPY apps/api/src ./apps/api/src
COPY scripts/build-web.mjs scripts/start-web.mjs ./scripts/
# Nonsecret private backend origin, fixed for this environment's build.
# No model, database, SMTP, enterprise-signing or OAuth credential build args.
ARG API_ORIGIN
RUN node scripts/build-web.mjs

FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb
WORKDIR /opt/desvio
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /opt/desvio/apps/web/.next/standalone ./
USER node
CMD ["node","start-web.mjs"]
