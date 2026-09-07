#!/bin/sh
# Writes CRON_SECRET to a root-only file rather than baking it into the
# crontab or a job's argv — `docker top`/`ps` on this container would
# otherwise show it in plain text for the ~1s each job runs.
set -eu
: "${CRON_SECRET:?CRON_SECRET must be set — same value as the web service}"

printf '%s' "${CRON_SECRET}" > /run/cron_secret
chmod 600 /run/cron_secret

cp /etc/cron.d/crontab.template /etc/crontabs/root
chmod 0600 /etc/crontabs/root

exec crond -f -l 2
