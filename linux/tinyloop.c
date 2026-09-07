/* A tiny, fully deterministic workload with data-dependent conditional branches.
 * With ASLR disabled, its instruction stream — and the address at any given
 * instruction index — is identical on every run. The single-stepper uses it to
 * demonstrate instruction-precise, reproducible preemption. */
int main(void) {
  volatile long a = 0;
  for (int i = 0; i < 1000; i++) {
    if (i & 1) a += i;
    else a -= i;
    if ((a % 7) < 3) a ^= (i << 1);
  }
  return (int)(a & 0x7f);
}
