#!/bin/sh
# Prove deterministic thread scheduling: run a racy multi-threaded program under
# the serializing tracer 3 times and require byte-identical interleaving, with
# uncontrolled runs shown for contrast. `timeout` guards against a scheduler
# deadlock (which would otherwise hang).
set -e
cd "$(dirname "$0")"

cc -O2 -o sched_record sched_record.c
cc -O2 -o racer racer.c -lpthread

echo "=== uncontrolled (plain) — interleaving is up to the OS ==="
p1=$(./racer); p2=$(./racer); p3=$(./racer)
printf '  %s\n  %s\n  %s\n' "$p1" "$p2" "$p3"
[ "$p1" = "$p2" ] && [ "$p2" = "$p3" ] && echo "  (note: plain runs happened to match on this host)" || echo "  (plain runs vary — real scheduling nondeterminism)"

echo "=== serialized (deterministic scheduler) — must be identical ==="
a=$(timeout 25 ./sched_record ./racer)
b=$(timeout 25 ./sched_record ./racer)
c=$(timeout 25 ./sched_record ./racer)
printf '  run1: %s\n  run2: %s\n  run3: %s\n' "$a" "$b" "$c"

rc=0
if [ -n "$a" ] && [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
  echo "PASS deterministic scheduler reproduced the thread interleaving across 3 runs"
else
  echo "FAIL scheduler output varied or was empty"; rc=1
fi
exit $rc
