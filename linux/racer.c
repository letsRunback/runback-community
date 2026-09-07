/*
 * racer — a multi-threaded program with REAL interleaving nondeterminism. T
 * threads each write their id in a loop, calling sched_yield() between writes to
 * invite the OS to interleave them — so the output order varies run to run.
 * main waits by spinning on a lock-free counter (no pthread_join → no blocking
 * syscall that could deadlock a serializing tracer). Under sched_record the
 * interleaving collapses to one fixed, reproducible order.
 */
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/syscall.h>

#define T 4
#define ITERS 10

static volatile int done = 0;

static void *worker(void *arg) {
  long id = (long)arg;
  for (int i = 0; i < ITERS; i++) {
    char b[4];
    int n = snprintf(b, sizeof b, "%ld", id);
    syscall(SYS_write, 1, b, (size_t)n);
    sched_yield(); /* invite a reschedule → real interleaving when uncontrolled */
  }
  __sync_fetch_and_add(&done, 1);
  return 0;
}

int main(void) {
  pthread_t th[T];
  for (long i = 0; i < T; i++) pthread_create(&th[i], 0, worker, (void *)(i + 1));
  while (__sync_fetch_and_add(&done, 0) < T) syscall(SYS_getpid); /* non-blocking wait */
  syscall(SYS_write, 1, "\n", 1);
  return 0;
}
