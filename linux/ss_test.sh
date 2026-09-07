#!/bin/sh
# Prove instruction-precise, reproducible preemption (the correctness property
# behind RCB-counter replay) WITHOUT a PMU: single-step a deterministic program
# and show (a) its total instruction count is identical across runs, and (b) the
# RIP after exactly N instructions is identical across runs.
set -e
cd "$(dirname "$0")"

cc -O0 -o tinyloop tinyloop.c
cc -O2 -o singlestep singlestep.c

echo "=== total retired-instruction count (must be identical) ==="
a=$(./singlestep count ./tinyloop); b=$(./singlestep count ./tinyloop); c=$(./singlestep count ./tinyloop)
printf '  %s\n  %s\n  %s\n' "$a" "$b" "$c"

echo "=== precise stop at N=20000 instructions (RIP must be identical) ==="
x=$(./singlestep stop 20000 ./tinyloop); y=$(./singlestep stop 20000 ./tinyloop); z=$(./singlestep stop 20000 ./tinyloop)
printf '  %s\n  %s\n  %s\n' "$x" "$y" "$z"

rc=0
if [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
  echo "PASS instruction count is a deterministic execution clock ($a)"
else
  echo "FAIL instruction count varied"; rc=1
fi
if [ "$x" = "$y" ] && [ "$y" = "$z" ]; then
  echo "PASS precise preemption point (RIP at instruction N) is reproducible"
else
  echo "FAIL preemption point varied"; rc=1
fi
exit $rc
