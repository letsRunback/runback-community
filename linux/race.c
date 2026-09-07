/*
 * race — a REAL in-memory data race, forced to manifest. T threads increment a
 * shared, NON-atomic counter. A lock-free spin barrier makes all threads enter
 * the increment loop together, so their load/add/store sequences overlap and
 * updates are LOST — the final value is below T*ITERS and nondeterministic.
 *
 * The race is entirely in memory, between syscalls, with no lock and no atomic on
 * the counter — so only an INSTRUCTION-granularity scheduler can reproduce it. The
 * barrier and the done-signal use atomics (they coordinate, they aren't the race);
 * main spins (no blocking syscall that would stall a single-stepping tracer).
 */
#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <sys/syscall.h>
#include <unistd.h>

#define T 3
#define ITERS 200

volatile long counter = 0;     /* deliberately racy: no lock, no atomic */
static volatile int ready = 0; /* spin-barrier arrival count (atomic) */
static volatile int done = 0;  /* completion count (atomic) */

static void *worker(void *arg) {
  (void)arg;
  /* lock-free barrier: arrive, then spin until everyone has arrived, so all
   * threads run the racy loop at the same time and actually collide */
  __sync_fetch_and_add(&ready, 1);
  while (__sync_fetch_and_add(&ready, 0) < T) { /* spin in memory */ }

  for (int i = 0; i < ITERS; i++) {
    counter = counter + 1; /* load, add, store — the race */
  }
  __sync_fetch_and_add(&done, 1);
  return 0;
}

int main(void) {
  pthread_t th[T];
  for (int i = 0; i < T; i++) pthread_create(&th[i], 0, worker, 0);
  while (__sync_fetch_and_add(&done, 0) < T) { /* spin — no blocking join */ }
  char b[32];
  int n = snprintf(b, sizeof b, "counter=%ld max=%d\n", counter, T * ITERS);
  syscall(SYS_write, 1, b, (size_t)n);
  return 0;
}
