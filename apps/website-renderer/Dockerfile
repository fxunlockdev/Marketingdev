ARG BASE_IMAGE=node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
FROM ${BASE_IMAGE}
ENV HOME=/tmp NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
WORKDIR /opt/website-renderer
COPY apps/website-renderer/package.json apps/website-renderer/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npx playwright install --with-deps chromium && npm cache clean --force && rm -rf /var/lib/apt/lists/* /root/.npm
COPY apps/website-renderer/runtime.mjs ./runtime.mjs
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["node","/opt/website-renderer/runtime.mjs"]
