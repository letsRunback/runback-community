#!/bin/sh
# Build the shim + probe, then prove: record a native run, replay it (after the
# wall clock advances and the pid changes), and confirm byte-identical output —
# with a control run to show the nondeterminism was real.
set -e
cd "$(dirname "$0")"

if [ "$(uname)" = "Darwin" ]; then
  cc -dynamiclib -o runback_native.dylib runback_native.c
  PRE="DYLD_INSERT_LIBRARIES=./runback_native.dylib"
else
  cc -shared -fPIC -o runback_native.so runback_native.c -ldl
  PRE="LD_PRELOAD=./runback_native.so"
fi
cc -o probe probe.c

env $PRE RUNBACK_MODE=record RUNBACK_CASSETTE=native.cassette ./probe > rec.out
sleep 1                                   # wall clock moves on
env $PRE RUNBACK_MODE=replay RUNBACK_CASSETTE=native.cassette ./probe > rep.out
./probe > plain.out                       # control: no shim

echo "record: $(cat rec.out)"
echo "replay: $(cat rep.out)"
echo "plain : $(cat plain.out)"
echo "cassette:"; sed 's/^/  /' native.cassette

rc=0
if diff -q rec.out rep.out >/dev/null; then
  echo "PASS replay reproduced the native run byte-for-byte, offline"
else
  echo "FAIL replay diverged"; rc=1
fi
if diff -q rec.out plain.out >/dev/null; then
  echo "WARN control matched record — nondeterminism didn't vary, proof is weak"
else
  echo "PASS control run differs — the nondeterminism was real"
fi

# ── fuse: native recording → signed, verifiable Runback audit (end-to-end) ──
if command -v npx >/dev/null 2>&1; then
  if AUDIT_SIGNING_KEY=test-key npx tsx ../packages/replay/bin/native-audit.ts --in native.cassette --out native.audit.json >/dev/null 2>&1 \
     && AUDIT_SIGNING_KEY=test-key npx tsx ../packages/replay/bin/native-audit.ts --verify native.audit.json; then
    echo "PASS native recording fused into a signed Runback audit and re-verified"
  else
    echo "FAIL native -> audit fusion did not verify"; rc=1
  fi
else
  echo "SKIP fusion step (npx not found)"
fi
exit $rc
