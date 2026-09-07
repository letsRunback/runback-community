/*
 * runback rcb_land — land at an exact retired-conditional-branch count.
 *
 * The capstone of instruction-precise replay: pin execution at the point where
 * exactly K retired conditional branches have executed, and report the precise
 * RIP there. An (RCB count, RIP) pair uniquely identifies an execution point —
 * rr's deterministic coordinate — so landing at K must reproduce the same RIP
 * every run. That is what lets you preempt one thread at the identical instant
 * across record and replay, and so reproduce an in-memory data race.
 *
 * THE RCB COUNTER, WIRED TO THE SINGLE-STEP LANDER:
 *   - If a hardware PMU exists, the *hardware* retired-conditional-branch counter
 *     (perf, BR_INST_RETIRED.CONDITIONAL) is the authoritative clock: enable it,
 *     single-step, and read the counter after each step until it reaches K.
 *   - If not (most cloud/CI VMs have no PMU — perf ENOENT), fall back to counting
 *     conditional branches in software by decoding the instruction at each step.
 *   Either way the lander single-steps to land EXACTLY at K and reports the RIP.
 *
 * The software path makes the correctness property — reproducible RCB-keyed
 * landing — provable on any Linux (CI). The hardware path is verified on the
 * self-hosted `pmu` runner. The remaining speed optimization (rr's trick) is to
 * arm the counter to overflow near K and PTRACE_CONT to fast-forward, then
 * single-step only the last few branches; that needs a PMU and is the next step.
 *
 * ASLR disabled in the child for address determinism.
 *
 *   rcb_land measure <target> [args]     -> total retired conditional branches
 *   rcb_land land <K> <target> [args]    -> RIP at exactly K conditional branches
 *
 * Build: cc -O2 -o rcb_land rcb_land.c     Linux x86-64.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <sys/uio.h>
#include <sys/personality.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <fcntl.h>
#include <linux/perf_event.h>

static int read_child(pid_t pid, unsigned long addr, void *out, size_t n) {
  struct iovec lo = {out, n}, ro = {(void *)addr, n};
  return process_vm_readv(pid, &lo, 1, &ro, 1, 0) == (ssize_t)n ? 0 : -1;
}

/* Is the instruction at these bytes a retired *conditional* branch?
 * Jcc rel8 (0x70-0x7F), Jcc rel32 (0x0F 0x80-0x8F), LOOPcc and JrCXZ (0xE0-0xE3). */
static int is_cond_branch(const unsigned char *b) {
  if (b[0] >= 0x70 && b[0] <= 0x7f) return 1;
  if (b[0] == 0x0f && b[1] >= 0x80 && b[1] <= 0x8f) return 1;
  if (b[0] >= 0xe0 && b[0] <= 0xe3) return 1;
  return 0;
}

/* Open the hardware retired-conditional-branch counter on `pid`, or -1. */
static int open_rcb_counter(pid_t pid) {
  struct perf_event_attr pe;
  memset(&pe, 0, sizeof pe);
  pe.type = PERF_TYPE_RAW;
  pe.config = 0x11c4; /* BR_INST_RETIRED.CONDITIONAL (modern Intel) */
  pe.size = sizeof pe;
  pe.disabled = 1;
  pe.exclude_kernel = 1;
  pe.exclude_hv = 1;
  long fd = syscall(__NR_perf_event_open, &pe, pid, -1, -1, 0UL);
  return (int)fd;
}
static long read_counter(int fd) {
  uint64_t c = 0;
  if (read(fd, &c, sizeof c) != (long)sizeof c) return -1;
  return (long)c;
}

/* The remaining speed step, PMU-only: arm a sampling counter to overflow after
 * `period` retired conditional branches and PTRACE_CONT the child so it
 * fast-forwards there in one shot — instead of single-stepping millions of
 * instructions. The kernel routes the overflow signal to the child thread, which
 * ptrace catches as a stop near the target; the caller then single-steps the last
 * few branches to land exactly. Returns 0 on success, -1 if perf is unavailable
 * or the child ran to exit (period too large). */
static int hw_fast_forward(pid_t pid, long period) {
  struct perf_event_attr pe;
  memset(&pe, 0, sizeof pe);
  pe.type = PERF_TYPE_RAW;
  pe.config = 0x11c4; /* BR_INST_RETIRED.CONDITIONAL */
  pe.size = sizeof pe;
  pe.disabled = 1;
  pe.exclude_kernel = 1;
  pe.exclude_hv = 1;
  pe.sample_period = period > 0 ? (uint64_t)period : 1;
  pe.wakeup_events = 1;
  int sfd = (int)syscall(__NR_perf_event_open, &pe, pid, -1, -1, 0UL);
  if (sfd < 0) return -1;

  /* deliver the overflow as a signal to the traced child thread */
  fcntl(sfd, F_SETFL, O_ASYNC);
  fcntl(sfd, F_SETSIG, SIGTRAP);
  struct f_owner_ex owner = {F_OWNER_TID, pid};
  fcntl(sfd, F_SETOWN_EX, &owner);
  ioctl(sfd, PERF_EVENT_IOC_RESET, 0);
  ioctl(sfd, PERF_EVENT_IOC_REFRESH, 1); /* allow exactly one overflow */

  int status;
  ptrace(PTRACE_CONT, pid, 0, 0);
  waitpid(pid, &status, 0);
  ioctl(sfd, PERF_EVENT_IOC_DISABLE, 0);
  close(sfd);
  if (WIFEXITED(status) || WIFSIGNALED(status)) return -1; /* period too large */
  return 0;
}

int main(int argc, char **argv) {
  int landmode = (argc >= 3 && !strcmp(argv[1], "land"));
  long K = landmode ? atol(argv[2]) : -1;
  char **target = landmode ? &argv[3] : &argv[2];
  if ((landmode && argc < 4) || (!landmode && argc < 3)) {
    fprintf(stderr, "usage: rcb_land measure <target> | land <K> <target>\n");
    return 2;
  }

  pid_t pid = fork();
  if (pid == 0) {
    personality(ADDR_NO_RANDOMIZE);
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    execvp(target[0], target);
    perror("execvp");
    _exit(127);
  }

  int status;
  waitpid(pid, &status, 0); /* initial post-exec stop */

  int hwfd = open_rcb_counter(pid); /* hardware clock if a PMU exists */
  const char *src = hwfd >= 0 ? "hw_rcb" : "sw_rcb";
  if (hwfd >= 0) { ioctl(hwfd, PERF_EVENT_IOC_RESET, 0); ioctl(hwfd, PERF_EVENT_IOC_ENABLE, 0); }

  /* PMU fast-path: jump near K in one shot via counter overflow, then single-step
   * the last FF_MARGIN branches below. A complete no-op without a PMU, so the
   * CI-proven software path is byte-for-byte unchanged. */
  const long FF_MARGIN = 2000;
  if (landmode && hwfd >= 0 && K > FF_MARGIN) {
    if (hw_fast_forward(pid, K - FF_MARGIN) == 0)
      fprintf(stderr, "[rcb_land] fast-forwarded to ~%ld via counter overflow\n", K - FF_MARGIN);
  }

  long rcb = 0; /* software tally (used when no PMU) */
  unsigned long land_rip = 0;
  for (;;) {
    struct user_regs_struct r;
    if (ptrace(PTRACE_GETREGS, pid, 0, &r) < 0) break;
    unsigned char ins[2] = {0};
    int cond = (read_child(pid, r.rip, ins, 2) == 0) && is_cond_branch(ins);

    if (ptrace(PTRACE_SINGLESTEP, pid, 0, 0) < 0) break;
    if (waitpid(pid, &status, 0) < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) break;

    if (cond) rcb++;                       /* software count */
    long now = (hwfd >= 0) ? read_counter(hwfd) : rcb; /* authoritative clock */

    if (landmode && now >= K) {
      struct user_regs_struct r2;
      ptrace(PTRACE_GETREGS, pid, 0, &r2);
      land_rip = r2.rip;
      kill(pid, SIGKILL);
      waitpid(pid, &status, 0);
      printf("land rcb=%ld rip=0x%lx src=%s\n", now, land_rip, src);
      if (hwfd >= 0) close(hwfd);
      return 0;
    }
  }

  long total = (hwfd >= 0) ? read_counter(hwfd) : rcb;
  if (hwfd >= 0) close(hwfd);
  printf("measure rcb=%ld src=%s\n", total, src);
  return 0;
}
