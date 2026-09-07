#!/bin/sh
# Prove RCB-keyed instruction-precise landing: measure a program's total retired
# conditional branches, then land at exactly K = total/2 three times and require
# the RIP to be identical. The RCB clock is the hardware PMU counter when present,
# software branch-decode otherwise — either way the landing must be reproducible.
set -e
cd "$(dirname "$0")"

cc -O0 -o tinyloop tinyloop.c
cc -O2 -o rcb_land rcb_land.c

m=$(./rcb_land measure ./tinyloop)
echo "  $m"
total=$(echo "$m" | sed -n 's/.*rcb=\([0-9]*\).*/\1/p')
K=$((total / 2))
[ "$K" -gt 0 ] 2>/dev/null || K=10
echo "  landing at K=$K conditional branches (half of $total)"

a=$(./rcb_land land "$K" ./tinyloop)
b=$(./rcb_land land "$K" ./tinyloop)
c=$(./rcb_land land "$K" ./tinyloop)
printf '  %s\n  %s\n  %s\n' "$a" "$b" "$c"

ra=$(echo "$a" | sed -n 's/.*rip=\(0x[0-9a-f]*\).*/\1/p')
rb=$(echo "$b" | sed -n 's/.*rip=\(0x[0-9a-f]*\).*/\1/p')
rc2=$(echo "$c" | sed -n 's/.*rip=\(0x[0-9a-f]*\).*/\1/p')

if [ -n "$ra" ] && [ "$ra" = "$rb" ] && [ "$rb" = "$rc2" ]; then
  echo "PASS landing at RCB=$K reproduced the exact RIP ($ra) across 3 runs"
else
  echo "FAIL RIP varied across runs: $ra / $rb / $rc2"
  exit 1
fi
