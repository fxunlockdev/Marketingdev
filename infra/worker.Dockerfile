ARG API_IMAGE
FROM docker:29.1.2-cli@sha256:21a1c55469066f188822c840c6524d53ee9839e22016d44ef7fbe33a9cd86d64 AS docker_cli
FROM ${API_IMAGE}
# Trusted worker only. The dedicated host supplies its private Docker socket;
# untrusted child runtimes never receive the socket or provider credentials.
COPY --from=docker_cli --chown=root:root /usr/local/bin/docker /usr/local/bin/docker
COPY --chown=root:root scripts/start-worker-host.mjs ./scripts/start-worker-host.mjs
USER node
CMD ["node","dist/worker-main.js"]
