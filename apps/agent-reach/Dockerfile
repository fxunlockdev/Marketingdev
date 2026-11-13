# Desvio research sandbox: Agent Reach at a pinned commit, login-free channels only.
# Built by scripts/agent-reach-test-image.mjs from an allowlisted context; never from the checkout.
ARG BASE_IMAGE=python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ARG NODE_IMAGE=node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
FROM ${NODE_IMAGE} AS node
FROM ${BASE_IMAGE}
ENV HOME=/tmp/home PYTHONPATH=/opt/agent-reach PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY apps/agent-reach/requirements.lock /opt/requirements.lock
# Hash-pinned wheels only: no source builds, no install scripts.
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/requirements.lock && rm /opt/requirements.lock
# yt-dlp solves YouTube's JavaScript challenges with a local runtime: the pinned Node binary.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY agent-reach-source/agent_reach /opt/agent-reach/agent_reach
COPY agent-reach-source/LICENSE /opt/agent-reach/LICENSE
COPY apps/agent-reach/channels.py /opt/agent-reach/agent_reach/channels/__init__.py
# Remove every login, cookie or browser channel and helper; Agent Reach is never set up, updated or
# allowed to install tools here (`setup`, `add`, `update` need uv and write outside the empty home).
RUN cd /opt/agent-reach/agent_reach \
 && rm -rf backends skill scripts \
 && rm -f channels/bilibili.py channels/boss.py channels/facebook.py channels/github.py channels/instagram.py \
    channels/linkedin.py channels/reddit.py channels/twitter.py channels/v2ex.py channels/xiaohongshu.py \
    channels/xiaoyuzhou.py channels/xueqiu.py channels/_opencli_site.py \
 && python -m compileall -q /opt/agent-reach \
 && node --version >/dev/null
COPY apps/agent-reach/runtime.py /opt/agent-reach-runtime/runtime.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python","/opt/agent-reach-runtime/runtime.py"]
