#!/bin/sh
set -eu
# Railway's fresh volume is root-owned. Only its mount root needs ownership repair.
mkdir -p /uploads
chown node:node /uploads
exec setpriv --reuid=node --regid=node --init-groups node /opt/desvio-postiz/start.mjs
