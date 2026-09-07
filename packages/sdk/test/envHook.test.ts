import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Community/Enterprise seam for H1 environment capture.
 *
 * Each test re-imports the modules through a reset registry so it can observe
 * the UNREGISTERED state — the state a Community build (which drops
 * src/enterprise/) is permanently in. Without resetting, importing the
 * enterprise module once anywhere in the suite would register it globally and
 * these tests would silently only ever exercise the licensed path.
 */
describe("envHook seam", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const sink = () => ({ recordEnv() {}, envDepth: 0 });

  it("reports unavailable before the enterprise module is imported", async () => {
    const hook = await import("../src/envHook.js");
    expect(hook.envCaptureAvailable()).toBe(false);
  });

  it("throws on an explicit captureEnv opt-in when H1 is absent", async () => {
    const hook = await import("../src/envHook.js");
    // Loud, not silent: recording a run that's missing its clock/random reads
    // would still produce a valid-looking digest that fails to reproduce later.
    expect(() => hook.enterEnvCaptureOrThrow(sink())).toThrow(/captureEnv requires/);
  });

  it("passes the function through, with one warning, when H1 is absent", async () => {
    const hook = await import("../src/envHook.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let ran = 0;
    expect(hook.withEnvCaptureIfAvailable(sink(), () => { ran++; return 42; })).toBe(42);
    hook.withEnvCaptureIfAvailable(sink(), () => { ran++; });
    expect(ran).toBe(2);
    // Warned once, not once per call — this runs on every agent invocation.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Only meaningful where the H1 module exists. A Community build has no
  // src/enterprise/, and its absence is the point — so this asserts the
  // registration path when present and skips (rather than fails) when not,
  // instead of the whole file being dropped and taking the three
  // fallback-behaviour cases above with it.
  it("becomes available once the enterprise module is imported", async (ctx) => {
    const hook = await import("../src/envHook.js");
    expect(hook.envCaptureAvailable()).toBe(false);
    let mod: unknown = null;
    try {
      mod = await import("../src/enterprise/envCapture.js"); // self-registers on import
    } catch {
      // Community build: no H1 module to register. ctx.skip(), not a bare
      // return — returning early reported this as PASSED, which overstates
      // what was actually exercised in exactly the build where the answer
      // matters most.
      ctx.skip();
      return;
    }
    expect(mod).toBeTruthy();
    expect(hook.envCaptureAvailable()).toBe(true);
    expect(() => hook.enterEnvCaptureOrThrow(sink())).not.toThrow();
  });
});
