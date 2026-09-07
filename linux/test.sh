#!/bin/sh
# Prove the syscall tier on Linux: record a target under ptrace, replay it (after
# the clock advances and the kernel would give fresh entropy), and confirm
# byte-identical output — then fuse the recording into the signed Runback audit.
set -e
cd "$(dirname "$0")"

cc -O2 -o syscall_record syscall_record.c
cc -O2 -o lprobe probe.c

RUNBACK_MODE=record RUNBACK_CASSETTE=sys.cassette ./syscall_record ./lprobe > rec.out
sleep 1
RUNBACK_MODE=replay RUNBACK_CASSETTE=sys.cassette ./syscall_record ./lprobe > rep.out
./lprobe > plain.out

echo "record: $(cat rec.out)"
echo "replay: $(cat rep.out)"
echo "plain : $(cat plain.out)"
echo "cassette:"; sed 's/^/  /' sys.cassette

rc=0
if diff -q rec.out rep.out >/dev/null; then
  echo "PASS syscall replay reproduced the run byte-for-byte (ptrace — no libc, no source change)"
else
  echo "FAIL replay diverged"; rc=1
fi
if diff -q rec.out plain.out >/dev/null; then
  echo "WARN control matched record — nondeterminism didn't vary"
else
  echo "PASS control run differs — the nondeterminism was real"
fi

# Same line-cassette format as the libc tier → fuses into the same signed audit.
if command -v npx >/dev/null 2>&1; then
  if AUDIT_SIGNING_KEY=test-key npx tsx ../packages/replay/bin/native-audit.ts --in sys.cassette --out sys.audit.json >/dev/null 2>&1 \
     && AUDIT_SIGNING_KEY=test-key npx tsx ../packages/replay/bin/native-audit.ts --verify sys.audit.json; then
    echo "PASS syscall recording fused into a signed Runback audit and re-verified"
  else
    echo "FAIL syscall -> audit fusion did not verify"; rc=1
  fi
fi
exit $rc
