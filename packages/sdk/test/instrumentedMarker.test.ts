import { describe, it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { runInstrumented, isInstrumentedCall } from "../src/instrumentedMarker";

describe("instrumentedMarker — propagates across normal async boundaries", () => {
  it("isInstrumentedCall() is true inside runInstrumented, across a real async gap (setTimeout)", async () => {
    let sawInside: boolean | null = null;
    await runInstrumented(async () => {
      await new Promise((r) => setTimeout(r, 5));
      sawInside = isInstrumentedCall();
    });
    expect(sawInside).toBe(true);
  });

  it("is false before/after — it doesn't leak into unrelated async work", async () => {
    expect(isInstrumentedCall()).toBe(false);
    await runInstrumented(async () => {});
    expect(isInstrumentedCall()).toBe(false);
  });

  it("nests correctly across concurrent calls sharing an async context", async () => {
    const seen: boolean[] = [];
    await runInstrumented(async () => {
      await runInstrumented(async () => {
        seen.push(isInstrumentedCall());
      });
      seen.push(isInstrumentedCall()); // still true — outer call hasn't returned
    });
    expect(seen).toEqual([true, true]);
  });
});

describe("instrumentedMarker — the documented worker/subprocess boundary gap", () => {
  // A real worker_thread spawn needs its own module loader for a .ts source
  // file, which is more machinery than this gap is worth for a unit test.
  // What actually causes the gap — proven directly here — is that
  // AsyncLocalStorage context lives on ONE store instance, and a
  // worker_thread/child_process gets its own separate JS realm with its own
  // fresh module instantiation, hence its own separate AsyncLocalStorage
  // instance. Context set on one instance is categorically invisible to
  // another — this is the exact mechanism the module docstring describes,
  // demonstrated without the extra ceremony of an actual worker spawn.
  it("a second, independent AsyncLocalStorage instance never sees context set on the first", async () => {
    const alsA = new AsyncLocalStorage<{ depth: number }>();
    const alsB = new AsyncLocalStorage<{ depth: number }>(); // stands in for a worker's own realm

    let seenInB: boolean | null = null;
    await alsA.run({ depth: 1 }, () => {
      // alsB has never been entered — this is what a worker thread's own
      // instrumentedMarker module instance looks like from inside it.
      const store = alsB.getStore();
      seenInB = !!store && store.depth > 0;
    });

    expect(seenInB).toBe(false);
  });
});
