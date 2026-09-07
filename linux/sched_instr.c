/*
 * runback sched_instr — INSTRUCTION-granularity deterministic scheduler.
 *
 * The scheduler tier (sched_record.c) serializes threads at *syscall* boundaries
 * — enough to reproduce the order of threads' syscalls, but NOT a pure in-memory
 * data race, which happens between syscalls. This goes one level deeper: it
 * single-steps every thread and advances exactly ONE instruction at a time, in a
 * deterministic round-robin over thread creation order. Every load/add/store of a
 * racy counter therefore interleaves identically on every run — so a program with
 * a genuine data race produces the IDENTICAL result each time, deterministically.
 *
 * This is the capability the whole determinism stack was climbing toward:
 * reproducing nondeterministic concurrency. It is the slow, universal form
 * (single-step); on a PMU host the RCB counter (rcb_land.c) lets you fast-forward
 * between preemption points so it is practical at scale.
 *
 * Same robust single-waitpid(-1,__WALL) event loop as sched_record.c, with
 * PTRACE_O_TRACECLONE so pthreads are auto-traced; PTRACE_SINGLESTEP replaces
 * PTRACE_SYSCALL. ASLR off for determinism.
 *
 * Build: cc -O2 -o sched_instr sched_instr.c     Run: ./sched_instr ./binary
 * Linux x86-64.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <sys/personality.h>

#ifndef __WALL
#define __WALL 0x40000000
#endif

#define MAXT 256
static pid_t T_[MAXT];
static int B_[MAXT]; /* born? (birth-stop consumed → schedulable) */
static int N = 0, cur = 0;
static pid_t running = 0;

static int idx_of(pid_t t) { for (int i = 0; i < N; i++) if (T_[i] == t) return i; return -1; }
static void add_t(pid_t t, int born) {
  if (idx_of(t) >= 0 || N >= MAXT) return;
  T_[N] = t; B_[N] = born; N++;
}
static void del_i(int i) { for (int j = i; j < N - 1; j++) { T_[j] = T_[j + 1]; B_[j] = B_[j + 1]; } N--; }

/* Single-step the next born thread in deterministic round-robin order. */
static int step_next(void) {
  for (int k = 0; k < N; k++) {
    int i = (cur + k) % N;
    if (B_[i]) { cur = (i + 1) % N; running = T_[i]; ptrace(PTRACE_SINGLESTEP, running, 0, 0); return 1; }
  }
  running = 0;
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: sched_instr <target> [args...]\n"); return 2; }

  pid_t pid = fork();
  if (pid == 0) {
    personality(ADDR_NO_RANDOMIZE);
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    execvp(argv[1], &argv[1]);
    perror("execvp");
    _exit(127);
  }

  int status;
  waitpid(pid, &status, 0); /* initial post-exec stop */
  ptrace(PTRACE_SETOPTIONS, pid, 0,
         (void *)(PTRACE_O_TRACECLONE | PTRACE_O_EXITKILL | PTRACE_O_TRACESYSGOOD));
  add_t(pid, 1);
  step_next();

  while (N > 0) {
    pid_t w = waitpid(-1, &status, __WALL);
    if (w < 0) { if (errno == EINTR) continue; break; }

    int i = idx_of(w);
    if (i < 0) { add_t(w, 1); if (running == 0) step_next(); continue; } /* unexpected birth */
    if (!B_[i]) { B_[i] = 1; if (running == 0) step_next(); continue; }  /* birth-stop */

    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      del_i(i);
    } else {
      unsigned ev = (unsigned)status >> 8;
      if (ev == (SIGTRAP | (PTRACE_EVENT_CLONE << 8))) {
        unsigned long nt = 0;
        if (ptrace(PTRACE_GETEVENTMSG, w, 0, &nt) == 0 && nt) add_t((pid_t)nt, 0);
      }
      /* w is parked at its post-instruction stop */
    }
    if (N == 0) break;
    step_next();
  }
  return 0;
}
