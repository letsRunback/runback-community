/*
 * runback_native — deterministic record/replay at the libc boundary.
 *
 * This is the native tier of the Runback determinism substrate. It interposes
 * the process's nondeterminism sources — libc clock/RNG (time, gettimeofday,
 * random) AND the kernel syscalls behind them (clock_gettime, getentropy) — so
 * that ANY dynamically-linked binary, in any language (C, C++, Go, Rust, Python,
 * a robot's control stack), can be recorded once and replayed byte-for-byte,
 * offline, with ZERO source changes. The in-process JS harness proves the
 * concept; this proves it generalizes to the whole process — including the
 * kernel CSPRNG every crypto stack draws from — which is the path to recording
 * and reproducing physical-autonomy software.
 *
 * Build (macOS):  cc -dynamiclib -o runback_native.dylib runback_native.c
 * Build (Linux):  cc -shared -fPIC -o runback_native.so runback_native.c -ldl
 *
 * Run:  RUNBACK_MODE=record RUNBACK_CASSETTE=run.cassette \
 *         DYLD_INSERT_LIBRARIES=./runback_native.dylib ./your_binary
 *       (Linux: LD_PRELOAD=./runback_native.so instead of DYLD_INSERT_LIBRARIES)
 *
 * Scope: this is the runtime tier (clock + RNG). The deeper syscall/scheduler
 * tier (rr/Hermit-class) is the multi-year systems frontier; this is its first
 * load-bearing rung. The line-based cassette here is converted to the signed,
 * hash-chained Runback cassette by the node toolchain so it fuses into the audit.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <sys/time.h>
#include <sys/random.h> /* getentropy */

static FILE *g_cas = NULL;          /* record sink */
static int g_mode = 0;              /* 0 passthrough · 1 record · 2 replay */
static int g_in = 0;                /* reentrancy guard */
static char **g_lines = NULL;       /* replay store */
static int g_nlines = 0, g_cur = 0;

static void load_replay(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) { g_mode = 0; return; }
  int cap = 64;
  g_lines = (char **)malloc(cap * sizeof(char *));
  char buf[256];
  while (fgets(buf, sizeof buf, f)) {
    size_t n = strlen(buf);
    if (n && buf[n - 1] == '\n') buf[n - 1] = 0;
    if (g_nlines >= cap) { cap *= 2; g_lines = (char **)realloc(g_lines, cap * sizeof(char *)); }
    g_lines[g_nlines++] = strdup(buf);
  }
  fclose(f);
}

__attribute__((constructor)) static void runback_init(void) {
  const char *mode = getenv("RUNBACK_MODE");
  const char *path = getenv("RUNBACK_CASSETTE");
  if (!mode || !path) return;
  if (!strcmp(mode, "record")) { g_cas = fopen(path, "w"); g_mode = g_cas ? 1 : 0; }
  else if (!strcmp(mode, "replay")) { g_mode = 2; load_replay(path); }
}

/* Next recorded value for `kind`, in strict recorded order. NULL on divergence. */
static const char *next_val(const char *kind) {
  if (g_cur >= g_nlines) {
    fprintf(stderr, "[runback-native] divergence: cassette exhausted (wanted %s)\n", kind);
    return NULL;
  }
  char *line = g_lines[g_cur];
  char *sp = strchr(line, ' ');
  if (!sp) return NULL;
  *sp = 0;
  if (strcmp(line, kind) != 0) {
    fprintf(stderr, "[runback-native] divergence at %d: expected %s, got %s\n", g_cur, line, kind);
    *sp = ' ';
    return NULL;
  }
  g_cur++;
  return sp + 1;
}
static void rec_val(const char *kind, const char *val) {
  if (g_cas) { fprintf(g_cas, "%s %s\n", kind, val); fflush(g_cas); }
}
static void rb_hex(const unsigned char *b, size_t n, char *out) {
  static const char *h = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) { out[2 * i] = h[b[i] >> 4]; out[2 * i + 1] = h[b[i] & 15]; }
  out[2 * n] = 0;
}
static int rb_unhex(const char *s, unsigned char *b, size_t n) {
  for (size_t i = 0; i < n; i++) { unsigned v; if (sscanf(s + 2 * i, "%2x", &v) != 1) return -1; b[i] = (unsigned char)v; }
  return 0;
}

/* Call the genuine libc function. On macOS a direct call from inside the
 * interposing image reaches real libc (verified: dyld does not redirect
 * self-image calls). On Linux (LD_PRELOAD same-name override) we must hop past
 * our own symbol with RTLD_NEXT. */
#ifdef __APPLE__
static time_t real_time(time_t *t) { return time(t); }
static int real_gtod(struct timeval *tv, void *tz) { return gettimeofday(tv, tz); }
static long real_random(void) { return random(); }
static int real_clock_gettime(clockid_t c, struct timespec *tp) { return clock_gettime(c, tp); }
static int real_getentropy(void *b, size_t n) { return getentropy(b, n); }
#else
static time_t real_time(time_t *t) {
  static time_t (*f)(time_t *) = NULL;
  if (!f) f = (time_t (*)(time_t *))dlsym(RTLD_NEXT, "time");
  return f(t);
}
static int real_gtod(struct timeval *tv, void *tz) {
  static int (*f)(struct timeval *, void *) = NULL;
  if (!f) f = (int (*)(struct timeval *, void *))dlsym(RTLD_NEXT, "gettimeofday");
  return f(tv, tz);
}
static long real_random(void) {
  static long (*f)(void) = NULL;
  if (!f) f = (long (*)(void))dlsym(RTLD_NEXT, "random");
  return f();
}
static int real_clock_gettime(clockid_t c, struct timespec *tp) {
  static int (*f)(clockid_t, struct timespec *) = NULL;
  if (!f) f = (int (*)(clockid_t, struct timespec *))dlsym(RTLD_NEXT, "clock_gettime");
  return f(c, tp);
}
static int real_getentropy(void *b, size_t n) {
  static int (*f)(void *, size_t) = NULL;
  if (!f) f = (int (*)(void *, size_t))dlsym(RTLD_NEXT, "getentropy");
  return f(b, n);
}
#endif

/* ── implementations (platform-independent) ─────────────────────────────── */
static time_t rb_time(time_t *t) {
  if (g_in || g_mode == 0) return real_time(t);
  g_in = 1;
  time_t r;
  if (g_mode == 2) { const char *v = next_val("time"); r = v ? (time_t)strtoll(v, 0, 10) : real_time(t); }
  else { r = real_time(t); char b[32]; snprintf(b, sizeof b, "%lld", (long long)r); rec_val("time", b); }
  if (t) *t = r;
  g_in = 0;
  return r;
}
static int rb_gettimeofday(struct timeval *tv, void *tz) {
  if (g_in || g_mode == 0 || !tv) return real_gtod(tv, tz);
  g_in = 1;
  int rc = 0;
  if (g_mode == 2) {
    const char *v = next_val("gettimeofday");
    if (v) { long long s = 0, u = 0; sscanf(v, "%lld.%lld", &s, &u); tv->tv_sec = (time_t)s; tv->tv_usec = (suseconds_t)u; }
    else rc = real_gtod(tv, tz);
  } else {
    rc = real_gtod(tv, tz);
    char b[48]; snprintf(b, sizeof b, "%lld.%06lld", (long long)tv->tv_sec, (long long)tv->tv_usec);
    rec_val("gettimeofday", b);
  }
  g_in = 0;
  return rc;
}
static long rb_random(void) {
  if (g_in || g_mode == 0) return real_random();
  g_in = 1;
  long r;
  if (g_mode == 2) { const char *v = next_val("random"); r = v ? strtol(v, 0, 10) : real_random(); }
  else { r = real_random(); char b[32]; snprintf(b, sizeof b, "%ld", r); rec_val("random", b); }
  g_in = 0;
  return r;
}
/* ── clock_gettime() — the high-resolution clock syscall ─────────────────── */
static int rb_clock_gettime(clockid_t c, struct timespec *tp) {
  if (g_in || g_mode == 0 || !tp) return real_clock_gettime(c, tp);
  g_in = 1;
  int rc = 0;
  if (g_mode == 2) {
    const char *v = next_val("clock_gettime");
    if (v) { long long s = 0, ns = 0; sscanf(v, "%lld.%lld", &s, &ns); tp->tv_sec = (time_t)s; tp->tv_nsec = (long)ns; }
    else rc = real_clock_gettime(c, tp);
  } else {
    rc = real_clock_gettime(c, tp);
    char b[48]; snprintf(b, sizeof b, "%lld.%09lld", (long long)tp->tv_sec, (long long)tp->tv_nsec);
    rec_val("clock_gettime", b);
  }
  g_in = 0;
  return rc;
}
/* ── getentropy() — the kernel CSPRNG syscall every crypto RNG draws from ── */
static int rb_getentropy(void *buf, size_t len) {
  if (g_in || g_mode == 0 || !buf || len == 0 || len > 256) return real_getentropy(buf, len);
  g_in = 1;
  int rc = 0;
  if (g_mode == 2) {
    const char *v = next_val("getentropy");
    if (v && strlen(v) >= 2 * len) rb_unhex(v, (unsigned char *)buf, len);
    else rc = real_getentropy(buf, len);
  } else {
    rc = real_getentropy(buf, len);
    if (rc == 0) { char hx[2 * 256 + 1]; rb_hex((const unsigned char *)buf, len, hx); rec_val("getentropy", hx); }
  }
  g_in = 0;
  return rc;
}

/* ── platform glue ──────────────────────────────────────────────────────── */
#ifdef __APPLE__
/* macOS: dyld interpose tuples redirect every caller to our replacement. */
#define DYLD_INTERPOSE(_repl, _orig)                                              \
  __attribute__((used)) static struct {                                          \
    const void *repl;                                                            \
    const void *orig;                                                            \
  } _interpose_##_orig __attribute__((section("__DATA,__interpose"))) = {        \
      (const void *)(unsigned long)&_repl, (const void *)(unsigned long)&_orig}
time_t my_time(time_t *t) { return rb_time(t); }
int my_gettimeofday(struct timeval *tv, void *tz) { return rb_gettimeofday(tv, tz); }
long my_random(void) { return rb_random(); }
int my_clock_gettime(clockid_t c, struct timespec *tp) { return rb_clock_gettime(c, tp); }
int my_getentropy(void *b, size_t n) { return rb_getentropy(b, n); }
DYLD_INTERPOSE(my_time, time);
DYLD_INTERPOSE(my_gettimeofday, gettimeofday);
DYLD_INTERPOSE(my_random, random);
DYLD_INTERPOSE(my_clock_gettime, clock_gettime);
DYLD_INTERPOSE(my_getentropy, getentropy);
#else
/* Linux: LD_PRELOAD same-name symbol override. */
time_t time(time_t *t) { return rb_time(t); }
int gettimeofday(struct timeval *tv, void *tz) { return rb_gettimeofday(tv, tz); }
long random(void) { return rb_random(); }
int clock_gettime(clockid_t c, struct timespec *tp) { return rb_clock_gettime(c, tp); }
int getentropy(void *b, size_t n) { return rb_getentropy(b, n); }
#endif
