FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV HOME=/tmp CRAWL4_AI_BASE_DIRECTORY=/tmp LITELLM_LOCAL_MODEL_COST_MAP=True PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
COPY requirements.lock /opt/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /opt/requirements.lock
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN python -m playwright install --with-deps chromium
COPY extract.py website.py visual.py /opt/
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python","/opt/extract.py"]
