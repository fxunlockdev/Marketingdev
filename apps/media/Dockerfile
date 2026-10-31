ARG BASE_IMAGE=node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
FROM ${BASE_IMAGE}
ENV HOME=/tmp NODE_ENV=production
WORKDIR /opt/render
COPY apps/media/package.json apps/media/package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 fonts-liberation2=2.1.5-1 fonts-dejavu-core=2.37-6 \
 && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 && apt-get purge -y --auto-remove python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev \
 && rm -rf /var/lib/apt/lists/* /root/.npm \
 && dpkg-query -W > /opt/render/system-packages.txt
COPY apps/web/public/fonts/ /opt/render/fonts/
COPY apps/media/fonts/ /opt/render/fonts/
COPY apps/media/runtime.mjs ./runtime.mjs
COPY apps/web/lib/curved-text.mjs ./curved-text.mjs
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["node","/opt/render/runtime.mjs"]
