/*
 * rcb_probe — is a hardware branch counter a DETERMINISTIC execution clock?
 *
 * Instruction-precise deterministic replay (rr/Hermit class) rests on one fact:
 * some CPU performance counter advances by the exact same amount every time the
 * same deterministic code runs, so it can serve as a "clock" to pin an execution
 * point. rr uses *retired conditional branches* (the one counter Intel makes
 * deterministic). This probe measures a fixed, branch-heavy, deterministic
 * workload under both the raw Intel BR_INST_RETIRED.CONDITIONAL event and the
 * portable PERF_COUNT_HW_BRANCH_INSTRUCTIONS, and prints the count. Run it N
 * times: if the count is identical every run, we have a usable execution clock —
 * the foundation for RCB-precise preemption.
 *
 * Userspace-only (exclude_kernel) so it works at perf_event_paranoid <= 2.
 *
 * Build: cc -O2 -o rcb_probe rcb_probe.c     Run: ./rcb_probe
 * Linux x86-64.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <linux/perf_event.h>

static long perf_open(struct perf_event_attr *pe) {
  return syscall(__NR_perf_event_open, pe, 0 /*this process*/, -1 /*any cpu*/, -1, 0UL);
}

/* The deterministic, branch-heavy workload. Same inputs every run ⇒ the exact
 * same sequence of taken/not-taken conditional branches. */
static uint64_t workload(void) {
  volatile uint64_t acc = 0;
  for (uint64_t i = 0; i < 2000000ULL; i++) {
    if (((i * 2654435761ULL) >> 13) & 1) acc += i;        /* data-dependent branch */
    if ((((uint64_t)i ^ acc) % 7) < 3) acc ^= (i << 1);   /* another */
  }
  return acc;
}

/* Count one event over the workload; returns -1 if perf is unavailable. */
static long count_event(uint32_t type, uint64_t config, const char *err) {
  struct perf_event_attr pe;
  memset(&pe, 0, sizeof pe);
  pe.type = type;
  pe.config = config;
  pe.size = sizeof pe;
  pe.disabled = 1;
  pe.exclude_kernel = 1;
  pe.exclude_hv = 1;
  long fd = perf_open(&pe);
  if (fd < 0) { fprintf(stderr, "[rcb] %s: perf_event_open: %s\n", err, strerror(errno)); return -1; }
  ioctl(fd, PERF_EVENT_IOC_RESET, 0);
  ioctl(fd, PERF_EVENT_IOC_ENABLE, 0);
  volatile uint64_t sink = workload();
  (void)sink;
  ioctl(fd, PERF_EVENT_IOC_DISABLE, 0);
  uint64_t c = 0;
  long n = read(fd, &c, sizeof c);
  close(fd);
  if (n != (long)sizeof c) { fprintf(stderr, "[rcb] %s: read failed\n", err); return -1; }
  return (long)c;
}

int main(void) {
  /* RAW config = (umask << 8) | event; BR_INST_RETIRED.CONDITIONAL = 0xC4/0x11 on modern Intel */
  long raw = count_event(PERF_TYPE_RAW, 0x11c4, "raw_cond");
  long hw = count_event(PERF_TYPE_HARDWARE, PERF_COUNT_HW_BRANCH_INSTRUCTIONS, "hw_branch");
  fprintf(stderr, "[rcb] raw_cond=%ld hw_branch=%ld\n", raw, hw);

  if (raw > 0) printf("rcb=%ld src=raw_cond\n", raw);
  else if (hw > 0) printf("rcb=%ld src=hw_branch\n", hw);
  else printf("rcb=UNAVAILABLE\n");
  return 0;
}
