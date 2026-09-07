#!/bin/sh
# Reproduce a REAL in-memory data race deterministically. Run a racy, lock-free
# program under the instruction-granularity scheduler 3x and require:
#   (1) the result is IDENTICAL every run — the race is reproduced deterministically;
#   (2) the result shows LOST UPDATES (counter < max) — proving a genuine race
#       occurred, not an accidental serialization.
# `timeout` guards against a single-stepping stall.
set -e
cd "$(dirname "$0")"

cc -O0 -o race race.c -lpthread          # -O0: the increment stays a load/add/store RMW
cc -O2 -o sched_instr sched_instr.c

echo "=== uncontrolled (plain) — racy, may vary ==="
./race; ./race; ./race || true

echo "=== instruction-deterministic scheduler — must be identical every run ==="
a=$(timeout 60 ./sched_instr ./race)
b=$(timeout 60 ./sched_instr ./race)
c=$(timeout 60 ./sched_instr ./race)
printf '  run1: %s\n  run2: %s\n  run3: %s\n' "$a" "$b" "$c"

val=$(echo "$a" | sed -n 's/.*counter=\([0-9]*\).*/\1/p')
max=$(echo "$a" | sed -n 's/.*max=\([0-9]*\).*/\1/p')

rc=0
if [ -n "$a" ] && [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
  echo "PASS data race reproduced DETERMINISTICALLY — identical result across 3 runs ($a)"
else
  echo "FAIL result varied across runs: [$a] [$b] [$c]"; rc=1
fi

if [ -n "$val" ] && [ -n "$max" ] && [ "$val" -lt "$max" ] 2>/dev/null; then
  echo "PASS the result shows lost updates ($val < $max) — a genuine data race, reproduced exactly"
else
  echo "FAIL no lost updates ($val/$max) — the race didn't manifest, so the demo isn't proving one"; rc=1
fi
exit $rc
