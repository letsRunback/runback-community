#!/bin/sh
# Layer 1 of RCB-precise preemption: is a hardware branch counter a deterministic
# execution clock on this host? Run the fixed workload 3x; the count must be
# identical. If perf is unavailable here, SKIP (green) rather than fail.
set -e
cd "$(dirname "$0")"

cc -O2 -o rcb_probe rcb_probe.c

# Userspace own-process counting needs perf_event_paranoid <= 2. CI runners often
# ship it locked at 4; lower it where we have (passwordless) sudo on an ephemeral
# runner. Best-effort — if we can't, the probe SKIPs cleanly.
sudo sysctl -w kernel.perf_event_paranoid=1 >/dev/null 2>&1 || true
echo "perf_event_paranoid = $(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo '?')"
a=$(./rcb_probe); b=$(./rcb_probe 2>/dev/null); c=$(./rcb_probe 2>/dev/null)
echo "  run1: $a"
echo "  run2: $b"
echo "  run3: $c"

case "$a" in
  *UNAVAILABLE*) echo "SKIP no virtualized hardware PMU on this runner (perf_event_open ENOENT) — the same constraint that stops rr from running in most cloud CI. The RCB clock needs a bare-metal or PMU-exposing host; the instruction-precise property is proven without a PMU by ss_test.sh."; exit 0 ;;
esac

if [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
  echo "PASS hardware branch counter is a deterministic execution clock ($a)"
else
  echo "FAIL counter varied across runs — not a usable execution clock"
  exit 1
fi
