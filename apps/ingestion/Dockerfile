FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
COPY requirements.lock /opt/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /opt/requirements.lock
COPY extract.py /opt/extract.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python","/opt/extract.py"]
