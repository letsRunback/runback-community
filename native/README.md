# Runback native tier — deterministic record/replay at the libc boundary

The in-process JS harness (`@runback/replay`) proves deterministic replay for
JS agents. This proves the substrate generalizes to **any native binary, in any
language, with zero source changes** — the rung toward recording and reproducing
non-JS and ultimately physical-autonomy software.

It interposes the process's nondeterminism sources — libc clock/RNG (`time`,
`gettimeofday`, `random`) **and the kernel syscalls behind them**
(`clock_gettime`, `getentropy` — the CSPRNG every crypto stack draws from) — so a
process can be **recorded once and replayed byte-for-byte, offline**. macOS uses
dyld interpose; Linux uses `LD_PRELOAD` symbol override.

## Prove it

```sh
sh test.sh
```

Expected: the recorded run and the replayed run print **identical** output (same
clock, same RNG) even though the wall clock advanced and the pid changed between
them — while a control run with no shim diverges:

```
record: time=… rand=1440793603,2068475983 clk=…487243000 ent=947178e82483a98e
replay: time=… rand=1440793603,2068475983 clk=…487243000 ent=947178e82483a98e  ← reproduced, incl. kernel entropy
plain : time=… rand=1352288297,1692747774 clk=…137799000 ent=917128dd365dacad  ← real nondeterminism
PASS replay reproduced the native run byte-for-byte, offline
PASS control run differs — the nondeterminism was real
✅ verified — digest ok, signature valid
PASS native recording fused into a signed Runback audit and re-verified
```

The five axes captured: `time`, `gettimeofday`, `random` (libc) and
`clock_gettime`, `getentropy` (syscalls — the high-res clock and the kernel
CSPRNG). The recording is then converted to a signed, hash-chained Runback
cassette and re-verified — the same audit artifact as a JS run.

## Use it on your own binary

```sh
# macOS
cc -dynamiclib -o runback_native.dylib runback_native.c
RUNBACK_MODE=record RUNBACK_CASSETTE=run.cassette \
  DYLD_INSERT_LIBRARIES=./runback_native.dylib ./your_program
RUNBACK_MODE=replay RUNBACK_CASSETTE=run.cassette \
  DYLD_INSERT_LIBRARIES=./runback_native.dylib ./your_program   # reproduces, offline

# Linux: build with `cc -shared -fPIC ... -ldl` and use LD_PRELOAD instead.
```

## Scope & roadmap (honest)

Captured today: libc clock/RNG **plus two real syscalls** — `clock_gettime` and
`getentropy` — via interposition. That's enough to deterministically reproduce
the clock and the **kernel CSPRNG**, which covers the nondeterminism in most real
programs (including crypto). The frontier is **universal** syscall capture (every
syscall, generically) and deterministic **thread scheduling** — the rr / Hermit /
Pernosco class using `ptrace` + `seccomp-bpf` + hardware performance counters.
That's a multi-year systems effort and the real depth of the moat. Verified facts
on why it's hard: rr can use only **one** deterministic CPU counter (retired
conditional branches) and must serialize all threads onto a single core;
record-replay tools run 3×–1,000× slower (rr targets <2×). Interposition (here)
is the load-bearing first rung; ptrace/seccomp is the climb above it.

The line-based cassette here is converted to the signed, hash-chained Runback
cassette by the node toolchain, so a native recording fuses into the same
verifiable audit as a JS run.
