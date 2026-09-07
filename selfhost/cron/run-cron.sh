#!/bin/sh
# Called by crond for each job in crontab.template, as: run-cron.sh <path>
# `web:3000` is the container's own compose-network hostname, not the public
# NEXT_PUBLIC_APP_URL — reaching it directly skips any reverse proxy/TLS in
# front of the public URL, which this container has no reason to go through.
set -eu
path="$1"
secret="$(cat /run/cron_secret)"
code=$(curl -sS -o /tmp/cron-last.log -w '%{http_code}' --max-time 300 \
  -H "Authorization: Bearer ${secret}" \
  "http://web:3000${path}") || code="curl-error"
if [ "$code" != "200" ]; then
  echo "[cron] ${path} -> ${code}: $(cat /tmp/cron-last.log 2>/dev/null)"
else
  echo "[cron] ${path} -> 200"
fi
