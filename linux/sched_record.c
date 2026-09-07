/*
 * runback sched — deterministic thread scheduling via ptrace serialization.
 *
 * A multi-threaded program's output order depends on how the OS interleaves its
 * threads across cores, so it varies run to run. This tool removes that
 * nondeterminism the way rr and Meta's Hermit do: it **serializes** every thread
 * onto one timeline and advances exactly ONE thread at a time, in a deterministic
 * round-robin over thread *creation order*. Only one thread is ever runnable, so
 * there is no race to observe; two runs produce the identical interleaving.
 *
 * Implementation is the standard robust ptrace-multithread pattern: a single
 * waitpid(-1, __WALL) event loop. New pthreads (PTRACE_O_TRACECLONE) start with a
 * pending "birth" stop that surfaces on a later waitpid; we mark such a thread
 * "born" then, and only schedule born threads — which avoids the per-thread
 * waitpid deadlock when a birth-stop is outstanding.
 *
 * Scope (honest first rung): deterministic at *syscall* granularity — enough to
 * reproduce the interleaving of threads' observable syscalls (their writes). It
 * does NOT yet reproduce a pure in-memory data race between syscalls (needs
 * instruction-precise preemption via the PMU retired-conditional-branch counter,
 * the rr technique) nor arbitrary cross-thread blocking. Those are the climb.
 *
 * Build:  cc -O2 -o sched_record sched_record.c     Run: ./sched_record ./binary
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

#ifndef __WALL
#define __WALL 0x40000000
#endif

#define MAXT 256
static pid_t T_[MAXT];
static int B_[MAXT]; /* born? (birth-stop consumed → schedulable) */
static int N = 0;
static int cur = 0;       /* round-robin cursor */
static pid_t running = 0; /* the one thread currently resumed */

static int idx_of(pid_t t) {
  for (int i = 0; i < N; i++) if (T_[i] == t) return i;
  return -1;
}
static void add_t(pid_t t, int born) {
  if (idx_of(t) >= 0 || N >= MAXT) return;
  T_[N] = t; B_[N] = born; N++;
}
static void del_i(int i) {
  for (int j = i; j < N - 1; j++) { T_[j] = T_[j + 1]; B_[j] = B_[j + 1]; }
  N--;
}

/* Resume the next born thread in deterministic round-robin order. */
static int resume_next(void) {
  for (int k = 0; k < N; k++) {
    int i = (cur + k) % N;
    if (B_[i]) {
      cur = (i + 1) % N;
      running = T_[i];
      ptrace(PTRACE_SYSCALL, running, 0, 0);
      return 1;
    }
  }
  running = 0;
  return 0; /* nothing schedulable (all unborn) — will resolve as births arrive */
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: sched_record <target> [args...]\n"); return 2; }

  pid_t pid = fork();
  if (pid == 0) {
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
  resume_next(); /* start the main thread */

  while (N > 0) {
    pid_t w = waitpid(-1, &status, __WALL);
    if (w < 0) {
      if (errno == EINTR) continue;
      break;
    }

    int i = idx_of(w);
    if (i < 0) {
      /* a brand-new thread's birth-stop arriving before we saw the clone event:
       * record it, parked. If nothing is currently running, start it. */
      add_t(w, 1);
      if (running == 0) resume_next();
      continue;
    }
    if (!B_[i]) {
      /* this thread's birth-stop — it's now schedulable, but parked. Keep the
       * running thread going; if none is running, this one starts the round. */
      B_[i] = 1;
      if (running == 0) resume_next();
      continue;
    }

    /* w is the thread we resumed; it has reached its next stop */
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      del_i(i);
    } else {
      unsigned ev = (unsigned)status >> 8;
      if (ev == (SIGTRAP | (PTRACE_EVENT_CLONE << 8))) {
        unsigned long nt = 0;
        if (ptrace(PTRACE_GETEVENTMSG, w, 0, &nt) == 0 && nt) add_t((pid_t)nt, 0); /* unborn */
      }
      /* w is now parked at this stop */
    }

    if (N == 0) break;
    if (!resume_next()) {
      /* no born thread to run yet — wait for a pending birth to arrive */
      if (N == 0) break;
    }
  }
  return 0;
}
