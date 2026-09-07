/*
 * probe — a tiny, unmodified native program whose output is nondeterministic on
 * five axes: time(), gettimeofday(), random() (pid-seeded), clock_gettime() (the
 * high-res clock syscall), and getentropy() (the kernel CSPRNG syscall). Recorded
 * once, it must replay identically even though the clock advanced, the pid is
 * different, and the kernel would hand back fresh entropy — with no code change.
 */
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <sys/time.h>
#include <sys/random.h>
#include <unistd.h>

int main(void) {
  srandom((unsigned)getpid()); /* different seed every run, unless replayed */
  time_t t = time(NULL);
  struct timeval tv;
  gettimeofday(&tv, NULL);
  long r1 = random(), r2 = random();
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  unsigned char ent[8] = {0};
  getentropy(ent, sizeof ent);

  printf("time=%lld gtod=%lld.%06lld rand=%ld,%ld clk=%lld.%09lld ent=%02x%02x%02x%02x%02x%02x%02x%02x\n",
         (long long)t, (long long)tv.tv_sec, (long long)tv.tv_usec, r1, r2,
         (long long)ts.tv_sec, (long long)ts.tv_nsec,
         ent[0], ent[1], ent[2], ent[3], ent[4], ent[5], ent[6], ent[7]);
  return 0;
}
