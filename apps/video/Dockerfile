ARG BASE_IMAGE=python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
FROM ${BASE_IMAGE}
COPY bundle/ /opt/video-deps/
COPY runtime.py /runtime/runtime.py
ARG RUNTIME_ARCH
COPY debian-${RUNTIME_ARCH}-packages.json /runtime/debian-packages.json
ENV PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
WORKDIR /runtime
ENTRYPOINT ["python", "/runtime/runtime.py"]
