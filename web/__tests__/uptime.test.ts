/**
 * A status page is only worth publishing if it can say "I don't know".
 *
 * The recorder runs inside the deployment, so a total outage stops the
 * recording rather than logging a failure. The tempting behaviour — no recent
 * failure, therefore green — turns silence into a health claim, which is
 * exactly backwards: during the worst outage the page would look best.
 *
 * So a stale record reports degraded, and only a RECENT PASS justifies green.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  last: { ok: boolean; checked_at: string; latency_ms: number | null; detail: string | null } | null;
  days: Record<string, unknown>[];
  rpcError: { message: string } | null;
} = { last: null, days: [], rpcError: null };

vi.mock("@/lib/supabase/admin", () => {
  const builder = () => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self; api.order = self; api.limit = self; api.insert = self;
    api.delete = self; api.lt = self;
    api.maybeSingle = async () => ({ data: state.last, error: null });
    api.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return api;
  };
  return {
    getAdminClient: () => ({
      from: builder,
      rpc: async () => (state.rpcError ? { data: null, error: state.rpcError } : { data: state.days, error: null }),
    }),
  };
});

const { uptimeStatus, STALE_AFTER_MINUTES } = await import("@/lib/uptime");

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => { state.last = null; state.days = []; state.rpcError = null; });

describe("current state", () => {
  it("is ok only when the last check passed AND is recent", async () => {
    state.last = { ok: true, checked_at: minutesAgo(2), latency_ms: 180, detail: null };
    expect((await uptimeStatus()).state).toBe("ok");
  });

  it("is down when the last check failed", async () => {
    state.last = { ok: false, checked_at: minutesAgo(2), latency_ms: 900, detail: "database unreachable" };
    const s = await uptimeStatus();
    expect(s.state).toBe("down");
    expect(s.detail).toBe("database unreachable");
  });

  it("is degraded — not ok — when the record has gone stale", async () => {
    // The recorder stopped. A passing check from an hour ago proves nothing
    // about now, and this is precisely the shape of a total outage.
    state.last = { ok: true, checked_at: minutesAgo(STALE_AFTER_MINUTES + 5), latency_ms: 180, detail: null };
    expect((await uptimeStatus()).state).toBe("degraded");
  });

  it("is degraded when nothing has ever been recorded", async () => {
    expect((await uptimeStatus()).state).toBe("degraded");
  });
});

describe("window uptime", () => {
  it("is computed from checks actually recorded", async () => {
    state.last = { ok: true, checked_at: minutesAgo(1), latency_ms: 100, detail: null };
    state.days = [
      { day: "2026-08-01", checks: 200, failures: 2, uptime_pct: 99, p50_ms: 180 },
      { day: "2026-07-31", checks: 300, failures: 3, uptime_pct: 99, p50_ms: 190 },
    ];
    const s = await uptimeStatus();
    // 495 of 500 → 99%. Not averaged across days, which would weight a quiet
    // day the same as a busy one.
    expect(s.windowUptimePct).toBe(99);
  });

  it("reports no figure rather than 100% when nothing was recorded", async () => {
    state.last = { ok: true, checked_at: minutesAgo(1), latency_ms: 100, detail: null };
    expect((await uptimeStatus()).windowUptimePct).toBeNull();
  });
});
