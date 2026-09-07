#!/bin/bash
# Sets the authenticator role password from the AUTHENTICATOR_PASSWORD env var.
# Runs after 00-roles.sql (which creates the role with a placeholder password).
# The Docker postgres entrypoint executes .sh init scripts as the postgres superuser.
set -euo pipefail

if [ -z "${AUTHENTICATOR_PASSWORD:-}" ]; then
  echo "ERROR: AUTHENTICATOR_PASSWORD is not set. PostgREST cannot connect to the database." >&2
  exit 1
fi

# Escape any single quotes in the password (SQL string delimiter).
ESCAPED_PW="${AUTHENTICATOR_PASSWORD//\'/\'\'}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "ALTER ROLE authenticator LOGIN PASSWORD '${ESCAPED_PW}';"

echo "authenticator role password configured."
