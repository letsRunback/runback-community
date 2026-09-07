/*
 * Linux probe — reads the kernel clock and CSPRNG *as raw syscalls*
 * (clock_gettime, getrandom). Under ptrace record it is captured; under replay
 * it must print identical output even though the kernel would hand back fresh
 * values — with no source change and no libc interposition.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <time.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Issue clock_gettime and getrandom as *raw* syscalls (via syscall(2)) so they
 * always trap into the kernel and are visible to the ptrace tracer. The glibc
 * clock_gettime() wrapper is served by the vDSO and never traps, so it would be
 * invisible to ptrace and could not be recorded/replayed. */
int main(void) {
  struct timespec ts = {0};
  syscall(SYS_clock_gettime, CLOCK_REALTIME, &ts);
  unsigned char e[8] = {0};
  syscall(SYS_getrandom, e, sizeof e, 0);
  printf("clk=%lld.%09lld ent=%02x%02x%02x%02x%02x%02x%02x%02x\n",
         (long long)ts.tv_sec, (long long)ts.tv_nsec,
         e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7]);
  return 0;
}
