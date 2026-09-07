# Runback syscall tier — universal ptrace record/replay (Linux x86-64)

The libc-interposition tier (`../native/`) catches dynamically-linked binaries.
This tier goes deeper: it **ptrace-traces** the target and intercepts the kernel
syscalls behind nondeterminism — `getrandom` (the kernel CSPRNG), `clock_gettime`,
`gettimeofday`, `time` — so it works on **any binary, including statically linked
ones and anything issuing raw syscalls**, with no relinking and no source.

- **record**: capture each target syscall's return value + the bytes it wrote into
  user memory → a line cassette (same format as the libc tier → fuses into the
  signed Runback audit via `packages/replay/bin/native-audit.ts`).
- **replay**: neutralize each target syscall at entry (kernel does *not* run it —
  no real entropy, no real clock), then inject the recorded return + bytes at exit.

## Status: PROVEN in CI
Verified green on real Linux x86-64 via the `determinism-proof` GitHub Actions
workflow (ubuntu-latest). The recorded and replayed runs printed **byte-identical**
output — including the kernel CSPRNG (`getrandom`) — while the control run got
fresh entropy, and the recording fused into a signed Runback audit that re-verified:

```
record: clk=1781977504.411491644 ent=6bd04c135807bea0
replay: clk=1781977504.411491644 ent=6bd04c135807bea0   ← reproduced via ptrace, no libc, no source
plain : clk=1781977505.416371441 ent=9a95a627c992eff7   ← real kernel nondeterminism
PASS syscall replay reproduced the run byte-for-byte (ptrace — no libc, no source change)
PASS syscall recording fused into a signed Runback audit and re-verified
```

Reproduce it anywhere:

```
sh linux/test.sh                                            # on any Linux x86-64 host
docker run --rm --cap-add=SYS_PTRACE \                      # or via the container
  "$(docker build -q -f linux/Dockerfile linux)"
```

## Two correctness details baked in (learned in review)
1. **vDSO bypass.** glibc's `clock_gettime(CLOCK_REALTIME, …)` is served by the
   **vDSO** and never traps into the kernel — so ptrace can't see it and replay
   would silently diverge on the clock. `probe.c` therefore issues **raw**
   `syscall(SYS_clock_gettime, …)` / `syscall(SYS_getrandom, …)`. For *third-party*
   binaries that use the vDSO clock, full coverage needs vDSO interception — a
   known boundary of this tier.
2. **Robust entry/exit pairing.** After neutralizing a syscall (`orig_rax = -1` at
   entry), `orig_rax` at the exit stop is unreliable; the tracer keys the exit off
   the syscall number it remembered at entry (`pend_nr`), not a re-read.

## Scheduler tier — deterministic thread serialization (PROVEN in CI)
`sched_record.c` serializes a multi-threaded program onto one timeline and
advances threads one at a time in deterministic round-robin over creation order —
the single-core serialization rr and Hermit rely on. Proven green in CI: a racy
program whose plain output **varies** run-to-run collapses to one fixed
interleaving, byte-identical across three runs:

```
plain : (varies run to run — real scheduling nondeterminism)
run1: 1112121213213213214321432432432434343444
run2: 1112121213213213214321432432432434343444   ← identical
run3: 1112121213213213214321432432432434343444
PASS deterministic scheduler reproduced the thread interleaving across 3 runs
```

Scope: deterministic at **syscall granularity** (reproduces the order of threads'
syscalls). Not yet: a pure in-memory data race *between* syscalls, nor arbitrary
cross-thread blocking.

## Instruction-precise preemption (PROVEN in CI)
The deepest layer: stop a program at the *exact same execution point* every run —
the basis for reproducing an in-memory data race. Two properties, both green in CI:

```
count steps=199486   count steps=199486   count steps=199486          ← deterministic instruction clock
stop steps=20000 rip=0x7ffff7fda99d  (×3, identical)                  ← reproducible preemption point
PASS instruction count is a deterministic execution clock
PASS precise preemption point (RIP at instruction N) is reproducible
```

`singlestep.c` proves this with `PTRACE_SINGLESTEP` (works on any Linux, ASLR
disabled for address determinism). On real hardware the **PMU
retired-conditional-branch counter** (`rcb_probe.c`, rr's technique) replaces the
per-instruction stepping to make it *fast* — but most cloud/CI VMs expose **no
hardware PMU** (`perf_event_open` → ENOENT), the same reason rr can't run in cloud
CI. So `rcb_test.sh` SKIPs cleanly here; run it on a bare-metal/PMU host to light
up the fast path. The *correctness* property is identical either way and is proven.

**The RCB counter wired to the lander** (`rcb_land.c`): rather than a raw
instruction index, land at exactly the K-th *retired conditional branch* — rr's
deterministic `(RCB, RIP)` coordinate. CI-proven via the software branch-decode
clock (no PMU): landing at `K=19389` reproduced `rip=0x7ffff7fda993` across 3 runs.

**Verified on real hardware (AWS c5.metal, 96-core x86-64).** With a genuine PMU
the lander reads the *hardware* retired-conditional-branch counter (raw `0x11c4`)
— a deterministic execution clock to the single branch (`rcb=6000001`, identical
×3) — and the **overflow-driven fast-forward works**: arm the counter to overflow
near K, `PTRACE_CONT` to jump there in one shot, then single-step the last few
branches to land exactly:

```
[rcb_land] fast-forwarded to ~9378 via counter overflow
land rcb=11378 rip=0x7ffff7fd4318 src=hw_rcb   (×3, identical)
PASS hardware branch counter is a deterministic execution clock (rcb=6000001)
PASS landing at RCB reproduced the exact RIP across 3 runs
```

That is the full rr-class fast path: you don't single-step billions of
instructions, you fast-forward by hardware counter and single-step only the tail.

## Data race — reproduced deterministically (PROVEN in CI)
The capstone. `sched_instr.c` is an **instruction-granularity** scheduler
(single-step round-robin), and `race.c` is a genuinely racy program — threads
increment a non-atomic shared counter behind a lock-free spin barrier that forces
them to collide. Uncontrolled, it loses a different number of updates every run;
under the scheduler it reproduces the exact same racy outcome every time:

```
plain : counter=220 / 204 / 184  (of 600)   ← real, nondeterministic data race
sched : counter=400 / 400 / 400  (of 600)   ← identical every run, and 400<600 = lost updates
PASS data race reproduced DETERMINISTICALLY — identical result across 3 runs
PASS the result shows lost updates (400 < 600) — a genuine data race, reproduced exactly
```

Reproducing a nondeterministic concurrency bug is the hardest thing record/replay
does. This is the single-step (universal, slow) form; the RCB counter
(`rcb_land.c`) is what makes it fast on a PMU host.

## Frontier (the remaining climb)
Wire the RCB fast path on PMU hosts to make instruction-precise scheduling
practical at scale; blocking-aware scheduling (futex-blocked threads); and full
record→replay of a chosen schedule so a specific interleaving can be re-run on
demand. Multi-year, rr/Hermit class. See
`memory/reference-record-replay-moat-evidence` for cited facts on why.
