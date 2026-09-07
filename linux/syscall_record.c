/*
 * runback syscall-record — universal deterministic record/replay via ptrace.
 *
 * This is the syscall tier: instead of interposing libc (which misses statically
 * linked binaries and anything that issues raw syscalls), it ptrace-traces the
 * target and intercepts the kernel syscalls that introduce nondeterminism —
 * getrandom (the kernel CSPRNG), clock_gettime, gettimeofday, time. It works on
 * ANY x86-64 Linux binary with no relinking and no source.
 *
 *   RECORD: run the target, capture each target syscall's return value and the
 *           bytes it wrote into user memory, append to the cassette (same line
 *           format as the libc tier, so it fuses into the signed Runback audit).
 *   REPLAY: neutralize each target syscall at entry (so the kernel does NOT run
 *           it — no real entropy drawn, no real clock read), then at exit inject
 *           the recorded return value and recorded buffer bytes. The target
 *           reproduces byte-for-byte, offline.
 *
 * This is the rr/Hermit-class technique, scoped to the high-value nondeterminism
 * syscalls. The remaining frontier is *every* syscall generically plus
 * deterministic thread scheduling (single-core serialization + branch-counter
 * progress), which is the multi-year depth.
 *
 * Build:  cc -O2 -o syscall_record syscall_record.c
 * Run:    RUNBACK_MODE=record RUNBACK_CASSETTE=run.cassette ./syscall_record ./target [args...]
 *         RUNBACK_MODE=replay RUNBACK_CASSETTE=run.cassette ./syscall_record ./target [args...]
 *
 * Linux x86-64 only (uses orig_rax/rax register layout + process_vm_*).
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/user.h>
#include <sys/uio.h>

/* x86-64 syscall numbers */
#define NR_gettimeofday 96
#define NR_time 201
#define NR_clock_gettime 228
#define NR_getrandom 318

static int is_target(long nr) {
  return nr == NR_getrandom || nr == NR_clock_gettime || nr == NR_gettimeofday || nr == NR_time;
}
static const char *kind_of(long nr) {
  switch (nr) {
    case NR_getrandom: return "getrandom";
    case NR_clock_gettime: return "clock_gettime";
    case NR_gettimeofday: return "gettimeofday";
    case NR_time: return "time";
    default: return "syscall";
  }
}

/* The user-memory buffer a syscall writes, and how many bytes, by convention:
 *   clock_gettime(clk, struct timespec* tp)  -> tp in rsi, 16 bytes
 *   gettimeofday(struct timeval* tv, tz)      -> tv in rdi, 16 bytes
 *   getrandom(void* buf, size_t len, flags)   -> buf in rdi, len in rsi
 *   time(time_t* t)                           -> t  in rdi, 8 bytes (and rax) */
static unsigned long buf_addr(long nr, const struct user_regs_struct *r) {
  if (nr == NR_clock_gettime) return r->rsi;
  if (nr == NR_gettimeofday) return r->rdi;
  if (nr == NR_getrandom) return r->rdi;
  if (nr == NR_time) return r->rdi;
  return 0;
}
static size_t buf_len(long nr, const struct user_regs_struct *r, long ret) {
  if (nr == NR_clock_gettime || nr == NR_gettimeofday) return 16;
  if (nr == NR_time) return 8;
  if (nr == NR_getrandom) return ret > 0 ? (size_t)ret : 0; /* bytes actually returned */
  return 0;
}

static int read_child(pid_t pid, unsigned long addr, void *out, size_t n) {
  if (!addr || !n) return 0;
  struct iovec lo = {out, n};
  struct iovec ro = {(void *)addr, n};
  return process_vm_readv(pid, &lo, 1, &ro, 1, 0) == (ssize_t)n ? 0 : -1;
}
static int write_child(pid_t pid, unsigned long addr, const void *in, size_t n) {
  if (!addr || !n) return 0;
  struct iovec lo = {(void *)in, n};
  struct iovec ro = {(void *)addr, n};
  return process_vm_writev(pid, &lo, 1, &ro, 1, 0) == (ssize_t)n ? 0 : -1;
}

static void to_hex(const unsigned char *b, size_t n, char *out) {
  static const char *h = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) { out[2 * i] = h[b[i] >> 4]; out[2 * i + 1] = h[b[i] & 15]; }
  out[2 * n] = 0;
}
static size_t from_hex(const char *s, unsigned char *b, size_t cap) {
  size_t n = 0;
  while (s[2 * n] && s[2 * n + 1] && n < cap) { unsigned v; sscanf(s + 2 * n, "%2x", &v); b[n++] = (unsigned char)v; }
  return n;
}

/* Replay store: a per-kind FIFO of recorded "<hexOrDec>" values. */
struct rec { char kind[24]; char val[1040]; };
static struct rec *g_rec = NULL;
static int g_n = 0, g_cap = 0;
static int g_cur[512]; /* unused index guard */

static void load_cassette(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) return;
  char line[1100];
  while (fgets(line, sizeof line, f)) {
    char *sp = strchr(line, ' ');
    if (!sp) continue;
    *sp = 0;
    char *val = sp + 1;
    size_t vn = strlen(val);
    if (vn && val[vn - 1] == '\n') val[vn - 1] = 0;
    if (g_n >= g_cap) { g_cap = g_cap ? g_cap * 2 : 64; g_rec = realloc(g_rec, g_cap * sizeof *g_rec); }
    snprintf(g_rec[g_n].kind, sizeof g_rec[g_n].kind, "%s", line);
    snprintf(g_rec[g_n].val, sizeof g_rec[g_n].val, "%s", val);
    g_n++;
  }
  fclose(f);
}
/* next recorded value for a kind, in order */
static const char *next_rec(const char *kind) {
  static int cur = 0;
  for (int i = cur; i < g_n; i++) {
    if (!strcmp(g_rec[i].kind, kind)) { cur = i + 1; return g_rec[i].val; }
  }
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: syscall_record <target> [args...]\n"); return 2; }
  const char *mode = getenv("RUNBACK_MODE");
  const char *cas = getenv("RUNBACK_CASSETTE");
  int record = mode && !strcmp(mode, "record");
  int replay = mode && !strcmp(mode, "replay");
  FILE *out = NULL;
  if (record && cas) out = fopen(cas, "w");
  if (replay && cas) load_cassette(cas);

  pid_t pid = fork();
  if (pid == 0) {
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    execvp(argv[1], &argv[1]);
    perror("execvp");
    _exit(127);
  }

  int status;
  waitpid(pid, &status, 0);
  ptrace(PTRACE_SETOPTIONS, pid, 0, PTRACE_O_EXITKILL);

  int at_entry = 1;
  long pend_nr = 0;
  unsigned long pend_addr = 0;

  for (;;) {
    if (ptrace(PTRACE_SYSCALL, pid, 0, 0) < 0) break;
    if (waitpid(pid, &status, 0) < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) break;

    struct user_regs_struct r;
    if (ptrace(PTRACE_GETREGS, pid, 0, &r) < 0) break;
    long nr = r.orig_rax;

    if (at_entry) {
      if (is_target(nr)) {
        pend_nr = nr;
        pend_addr = buf_addr(nr, &r);
        if (replay) {
          /* neutralize: make the kernel run an invalid syscall (no real effect) */
          r.orig_rax = -1;
          ptrace(PTRACE_SETREGS, pid, 0, &r);
        }
      }
    } else {
      /* syscall exit. Detect the target by the syscall we remembered at entry,
       * NOT by re-reading orig_rax here: in replay we neutralized the syscall by
       * setting orig_rax = -1, and depending on the kernel orig_rax at the exit
       * stop reads back as either -1 or the original number — neither is
       * reliable. pend_nr is set only when the matching entry was a target, so
       * it is the authoritative identity of the syscall now exiting. */
      if (pend_nr) {
        long use_nr = pend_nr;
        long ret = (long)r.rax;
        const char *kind = kind_of(use_nr);

        if (record) {
          size_t n = buf_len(use_nr, &r, ret);
          if (use_nr == NR_time) {
            /* time() returns the value in rax; also writes *t if non-null */
            fprintf(out, "time %ld\n", ret);
          } else if (n) {
            unsigned char buf[1024];
            if (n > sizeof buf) n = sizeof buf;
            if (read_child(pid, pend_addr, buf, n) == 0) {
              char hex[2 * 1024 + 1];
              to_hex(buf, n, hex);
              fprintf(out, "%s %s\n", kind, hex);
            }
          }
          fflush(out);
        } else if (replay) {
          const char *v = next_rec(kind);
          if (v) {
            if (use_nr == NR_time) {
              long t = strtol(v, NULL, 10);
              r.rax = (unsigned long)t;
              ptrace(PTRACE_SETREGS, pid, 0, &r);
              if (pend_addr) write_child(pid, pend_addr, &t, sizeof t);
            } else {
              unsigned char buf[1024];
              size_t n = from_hex(v, buf, sizeof buf);
              write_child(pid, pend_addr, buf, n);
              r.rax = (use_nr == NR_getrandom) ? (unsigned long)n : 0; /* clock/gtod return 0 */
              ptrace(PTRACE_SETREGS, pid, 0, &r);
            }
          }
        }
        pend_nr = 0;
        pend_addr = 0;
      }
    }
    at_entry = !at_entry;
  }

  if (out) fclose(out);
  (void)g_cur;
  return 0;
}
