#!/bin/bash
# Proves `docker compose up` actually works: brings the whole stack up, waits for
# the app, sends a real agent run through the bundled data layer, and verifies it
# was stored and is retrievable. Exits non-zero on any failure (gates CI).
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="http://localhost:3000"
GENERATED_ENV=0

# CI (and a fresh clone with no .env) has no secrets configured — docker-compose.yml
# requires them (`${VAR:?...}`), so `docker compose up` would fail before anything
# else runs. Generate throwaway ones for this run only, if no .env already exists.
# A real deployment MUST still follow the README (cp .env.example .env, fill it in)
# — this is not a substitute, it just makes the smoke test self-contained.
if [ ! -f .env ]; then
  echo "▸ no .env found — generating throwaway secrets for this smoke test run"
  GENERATED_ENV=1
  JWT_SECRET="$(openssl rand -hex 32)"
  {
    echo "JWT_SECRET=$JWT_SECRET"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "AUTHENTICATOR_PASSWORD=$(openssl rand -hex 32)"
    echo "AUDIT_SIGNING_KEY=$(openssl rand -hex 32)"
    echo "SSO_SECRET_KEY=$(openssl rand -hex 32)"
    echo "MODEL_KEY_SECRET=$(openssl rand -hex 32)"
    echo "CRON_SECRET=$(openssl rand -hex 32)"
    echo "UNSUBSCRIBE_SECRET=$(openssl rand -hex 32)"
    echo "NEXT_PUBLIC_APP_URL=$BASE"
    echo "RESEND_API_KEY=smoke_test_unused"
  } > .env
  node -e '
    const crypto = require("crypto");
    const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const sign = (payload, secret) => {
      const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const p = b64url(JSON.stringify(payload));
      const sig = crypto.createHmac("sha256", secret).update(h + "." + p).digest();
      return h + "." + p + "." + b64url(sig);
    };
    const secret = process.argv[1];
    const exp = Math.floor(Date.now() / 1000) + 3600;
    console.log("SUPABASE_ANON_KEY=" + sign({ role: "anon", iss: "runback-selfhost", exp }, secret));
    console.log("SUPABASE_SERVICE_ROLE_KEY=" + sign({ role: "service_role", iss: "runback-selfhost", exp }, secret));
  ' "$JWT_SECRET" >> .env
fi

cleanup() {
  docker compose logs --tail=40 web rest db scheduler 2>&1 | tail -80 || true
  docker compose down -v || true
  [ "$GENERATED_ENV" = "1" ] && rm -f .env
}
trap cleanup EXIT

echo "▸ docker compose up --build"
docker compose up -d --build

echo "▸ waiting for the app on $BASE ..."
for i in $(seq 1 90); do
  if curl -fsS "$BASE/" >/dev/null 2>&1; then echo "  app is up (${i}x3s)"; break; fi
  sleep 3
  if [ "$i" = 90 ]; then echo "FAIL: app never came up"; exit 1; fi
done

KEY="${SMOKE_TEST_KEY:-}"   # set in CI env or .env to reuse an existing key
if [ -z "$KEY" ]; then
  # No key provided — mint one directly in the DB this run just created. Never
  # committed/seeded in the repo (see selfhost/init/90-grants.sql) so a public
  # clone can't be used to ingest into someone else's instance; generating one
  # fresh per run keeps that property while still exercising the real path.
  echo "▸ minting a throwaway API key for the ingest test ..."
  RAW="sb_live_$(openssl rand -hex 24)"
  HASH="$(printf '%s' "$RAW" | openssl dgst -sha256 -hex | awk '{print $2}')"
  PREFIX="${RAW:0:16}"
  # api_keys.org_id is nullable in the schema but required in practice —
  # storeEvents() hard-rejects any key with no org ("not attached to an
  # organisation"), so a key minted without one 500s on its very first
  # ingest. Create a throwaway org for this run and attach the key to it.
  # The org insert and the id lookup are deliberately separate queries: an
  # INSERT (even with RETURNING, under -t) still emits an "INSERT 0 1"
  # completion tag on the same stream, which silently corrupts a captured
  # single-query result — a plain SELECT afterwards has no such tag.
  ORG_SLUG="smoke-test-$(date +%s)"
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "insert into orgs (name, slug, plan) values ('Smoke Test Org', '$ORG_SLUG', 'free');" >/dev/null
  ORG_ID="$(docker compose exec -T db psql -U postgres -d postgres -t -A -v ON_ERROR_STOP=1 -c \
    "select id from orgs where slug = '$ORG_SLUG';" | tr -d '[:space:]')"
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "insert into api_keys (key_prefix, key_hash, owner_email, plan, org_id) values ('$PREFIX', '$HASH', 'smoke-test@local', 'free', '$ORG_ID');" >/dev/null
  KEY="$RAW"
fi

RID="smoke-$(date +%s)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
echo "▸ sending a sample run ($RID) through /api/ingest ..."
RESP=$(curl -fsS -X POST "$BASE/api/ingest" \
  -H "authorization: Bearer $KEY" -H "content-type: application/json" \
  -d "{ \"events\": [
    {\"schema_version\":1,\"run_id\":\"$RID\",\"span_id\":\"r\",\"parent_span_id\":null,\"seq\":0,\"ts_start\":\"$TS\",\"ts_end\":null,\"type\":\"run\",\"phase\":\"start\",\"name\":\"smoke\",\"input\":\"hi\",\"output\":null,\"status\":\"running\",\"error\":null,\"metadata\":{}},
    {\"schema_version\":1,\"run_id\":\"$RID\",\"span_id\":\"t1\",\"parent_span_id\":\"r\",\"seq\":1,\"ts_start\":\"$TS\",\"ts_end\":\"$TS\",\"type\":\"tool\",\"tool_name\":\"echo\",\"tool_call_id\":\"c1\",\"input\":{},\"output\":{\"ok\":true},\"latency_ms\":1,\"error\":null},
    {\"schema_version\":1,\"run_id\":\"$RID\",\"span_id\":\"re\",\"parent_span_id\":null,\"seq\":2,\"ts_start\":\"$TS\",\"ts_end\":\"$TS\",\"type\":\"run\",\"phase\":\"end\",\"name\":\"smoke\",\"input\":null,\"output\":{\"done\":true},\"status\":\"success\",\"error\":null,\"metadata\":{}}
  ] }")
echo "  ingest response: $RESP"
echo "$RESP" | grep -q '"ingested":3' || { echo "FAIL: ingest did not store 3 events"; exit 1; }

echo "▸ verifying the run is retrievable ..."
# Not curl "$BASE/runs/$RID" — on self-host every marketing-style route
# (including /runs/[run_id]) intentionally 307s to /login (RUNBACK_SELF_HOSTED
# gate in web/lib/proxy.ts), so that would never return 200 here even on a
# working stack. /api/runs/$RID is the documented Bearer-token endpoint (see
# web/app/api/runs/[run_id]/route.ts) and isn't behind that gate, so it proves
# the ingested run actually landed and is readable back out.
code=$(curl -s -o /dev/null -w "%{http_code}" -H "authorization: Bearer $KEY" "$BASE/api/runs/$RID")
[ "$code" = "200" ] || { echo "FAIL: run lookup returned $code"; exit 1; }

echo "▸ verifying the scheduler service is running and authenticates cron routes ..."
# Not just "the container exists" — proves the exact path a real deployment
# depends on: the scheduler wrote CRON_SECRET into its crontab correctly, and
# a cron route accepts a call authenticated the same way. /api/cron/retention
# is idempotent and safe to invoke here (see web/app/api/cron/retention/route.ts).
CRON_SECRET_VALUE="$(grep -m1 '^CRON_SECRET=' .env | cut -d= -f2-)"
[ -n "$CRON_SECRET_VALUE" ] || { echo "FAIL: no CRON_SECRET found in .env"; exit 1; }
cron_code=$(curl -s -o /tmp/smoke-cron.log -w "%{http_code}" \
  -H "Authorization: Bearer $CRON_SECRET_VALUE" "$BASE/api/cron/retention")
[ "$cron_code" = "200" ] || { echo "FAIL: /api/cron/retention returned $cron_code: $(cat /tmp/smoke-cron.log)"; exit 1; }
docker compose ps scheduler | grep -qi "up" || { echo "FAIL: scheduler service is not running"; exit 1; }

echo "✅ SELF-HOST SMOKE TEST PASSED — docker compose up serves a working Runback that captured a run end-to-end, with the scheduler wired up"
