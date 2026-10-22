FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV HOME=/tmp PYTHONPATH=/opt/app PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LANGCHAIN_TRACING_V2=false LANGSMITH_TRACING=false
COPY apps/skills/requirements.lock /opt/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /opt/requirements.lock
COPY scripts/skill_audit.py /opt/app/scripts/skill_audit.py
COPY inputs/marketingskills-main.zip /opt/app/inputs/marketingskills-main.zip
COPY apps/skills/runtime.py /opt/app/apps/skills/runtime.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python","/opt/app/apps/skills/runtime.py"]
