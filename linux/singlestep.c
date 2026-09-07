/*
 * runback singlestep — instruction-precise, reproducible preemption (no PMU).
 *
 * Instruction-precise deterministic replay needs the ability to stop a program
 * at the *exact same execution point* every time. The fast way is the PMU
 * retired-conditional-branch counter (rr's technique) — but most cloud/CI VMs
 * don't expose a hardware PMU (see rcb_probe). The SLOW-but-universal way is to
 * single-step and count instructions. This tool does that to PROVE the
 * correctness property — that a precise preemption point is reproducible — on any
 * Linux. On real hardware the RCB counter replaces the per-instruction stepping
 * to make it practical; the property demonstrated here is identical.
 *
 * ASLR is disabled in the child (personality ADDR_NO_RANDOMIZE) so the address at
 * a given instruction index is itself deterministic.
 *
 *   singlestep count <target> [args...]      -> total retired instruction count
 *   singlestep stop  <N> <target> [args...]  -> RIP after exactly N instructions
 *
 * Build: cc -O2 -o singlestep singlestep.c     Linux x86-64.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <sys/personality.h>

int main(int argc, char **argv) {
  int stopmode = (argc >= 3 && !strcmp(argv[1], "stop"));
  long N = stopmode ? atol(argv[2]) : -1;
  char **target = stopmode ? &argv[3] : &argv[2];
  if ((stopmode && argc < 4) || (!stopmode && argc < 3)) {
    fprintf(stderr, "usage: singlestep count <target> | stop <N> <target>\n");
    return 2;
  }

  pid_t pid = fork();
  if (pid == 0) {
    personality(ADDR_NO_RANDOMIZE); /* deterministic addresses */
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    execvp(target[0], target);
    perror("execvp");
    _exit(127);
  }

  int status;
  waitpid(pid, &status, 0); /* initial post-exec stop */
  unsigned long steps = 0;
  for (;;) {
    if (ptrace(PTRACE_SINGLESTEP, pid, 0, 0) < 0) break;
    if (waitpid(pid, &status, 0) < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) break;
    steps++;
    if (stopmode && steps >= (unsigned long)N) {
      struct user_regs_struct r;
      ptrace(PTRACE_GETREGS, pid, 0, &r);
      printf("stop steps=%lu rip=0x%llx\n", steps, (unsigned long long)r.rip);
      kill(pid, SIGKILL);
      waitpid(pid, &status, 0);
      return 0;
    }
  }
  printf("count steps=%lu\n", steps);
  return 0;
}
