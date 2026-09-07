#!/usr/bin/env bash
# Pre-ship gate: build, serve the production build locally with real data, run the
# browser gate (_ttproof.cjs) over every key page on desktop + mobile, then tear down.
# Exit code is the gate's — wire it before `vercel --prod`.
cd "$(dirname "$0")/.." || exit 1

# Static guards first — they cost seconds and catch whole classes of shipped bug
# (an unauthenticated route, a plan gate that ignores the trial). Both were
# orphaned scripts nobody ran; wiring them here is the point of having them.
echo "▸ auditing route guards + entitlement gates…"
node scripts/audit-route-guards.mjs || exit 1
node scripts/audit-entitlements.mjs || exit 1

# Schema drift: sql/ is applied by hand, so nothing otherwise verifies the
# database actually has what the code expects. Six unapplied migrations once
# broke ingest and login while every page still rendered "no data yet".
# Skips itself cleanly when no Supabase credentials are present.
echo "▸ checking schema drift…"
node scripts/check-schema.mjs || exit 1

# The other direction: columns the CODE asks for that no migration declares.
# check-schema.mjs runs sql/ → db and cannot see these. PostgREST answers a bad
# column with a 400 that every `const { data }` call site swallows, so the bug
# ships as an empty page rather than an error. Four features were dead this way.
echo "▸ checking code → db columns…"
node scripts/audit-db-columns.mjs || exit 1

# Lint was red on main for weeks because nothing ran it — not this gate, not CI.
echo "▸ linting…"
npm run lint || exit 1

echo "▸ building…"
npm run build >/tmp/rb-gate-build.log 2>&1 || { echo "✗ build failed"; tail -20 /tmp/rb-gate-build.log; exit 1; }

set -a; . ./.env 2>/dev/null; set +a
PORT=3210 npm run start --workspace @runback/web >/tmp/rb-gate-srv.log 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null; pkill -f "next start" 2>/dev/null; pkill -f "next-server" 2>/dev/null; }
trap cleanup EXIT

echo "▸ waiting for server…"
for i in $(seq 1 40); do
  if curl -s -o /dev/null -w '%{http_code}' http://localhost:3210/ 2>/dev/null | grep -q 200; then echo "  ready"; break; fi
  sleep 1
done

echo "▸ running browser gate…"
BASE=http://localhost:3210 node _ttproof.cjs
exit $?
