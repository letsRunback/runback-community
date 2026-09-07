/**
 * Seat-limit enforcement — PLAN_LIMITS[...].seats existed since the plan
 * table was written but was read nowhere except display. These pin the
 * actual enforcement: seatStatus() counting real committed memberships (not
 * pending invites), and that the three "add a membership" call sites this
 * session wired up (inviteMember, attachMembership, and — exercised via
 * seatStatus directly here rather than duplicating consumeMagicLink's full
 * token-consumption machinery — the same seatStatus() check
 * consumeMagicLink/scim.ts both call) all agree on the same answer for the
 * same org.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  orgs: { id: string; plan: string; trial_ends_at: string | null }[];
  memberships: { org_id: string; user_id: string; role: string }[];
} = { orgs: [], memberships: [] };

vi.mock("@/lib/supabase/admin", () => {
  const build = (table: string) => {
    const f: Record<string, unknown> = {};
    let headCount = false;
    const api: Record<string, unknown> = {};
    api.select = (_cols?: string, opts?: { head?: boolean; count?: string }) => {
      if (opts?.head) headCount = true;
      return api;
    };
    api.eq = (c: string, v: unknown) => { f[c] = v; return api; };
    api.insert = (row: Record<string, unknown>) => {
      if (table === "memberships") state.memberships.push(row as { org_id: string; user_id: string; role: string });
      return api;
    };
    api.upsert = (row: Record<string, unknown>) => {
      if (table === "memberships") {
        const m = row as { org_id: string; user_id: string; role: string };
        const existing = state.memberships.find((x) => x.org_id === m.org_id && x.user_id === m.user_id);
        if (!existing) state.memberships.push(m); // ignoreDuplicates semantics — never overwrite an existing role
      }
      return api;
    };
    api.maybeSingle = async () => {
      if (table === "orgs") {
        const o = state.orgs.find((x) => x.id === f.id);
        return { data: o ?? null, error: null };
      }
      if (table === "memberships") {
        const m = state.memberships.find((x) => x.org_id === f.org_id && x.user_id === f.user_id);
        return { data: m ?? null, error: null };
      }
      return { data: null, error: null };
    };
    const result = () => {
      if (table === "memberships" && headCount) {
        const rows = state.memberships.filter((m) =>
          (f.org_id === undefined || m.org_id === f.org_id) &&
          (f.role === undefined || m.role === f.role)
        );
        return { data: null, error: null, count: rows.length };
      }
      return { data: [], error: null };
    };
    api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return api;
  };
  return { getAdminClient: () => ({ from: (t: string) => build(t) }) };
});

const { seatStatus } = await import("@/lib/seats");
const { inviteMember } = await import("@/lib/team");
const { attachMembership } = await import("@/lib/auth");

vi.mock("@/lib/email", () => ({ sendMagicLink: async () => true }));

const ORG = "org-1";

beforeEach(() => {
  state.orgs = [{ id: ORG, plan: "free", trial_ends_at: null }]; // free: 1 seat
  state.memberships = [{ org_id: ORG, user_id: "u1", role: "owner" }];
});

describe("seatStatus", () => {
  it("reports the free plan's 1-seat limit and marks it full at 1 member", async () => {
    const s = await seatStatus(ORG);
    expect(s).toEqual({ used: 1, limit: 1, available: false });
  });

  it("becomes available again once seats open up (e.g. after a plan change)", async () => {
    state.orgs[0].plan = "starter"; // 5 seats
    const s = await seatStatus(ORG);
    expect(s).toEqual({ used: 1, limit: 5, available: true });
  });

  it("is always available on enterprise (unmetered)", async () => {
    state.orgs[0].plan = "enterprise";
    state.memberships = Array.from({ length: 50 }, (_, i) => ({ org_id: ORG, user_id: `u${i}`, role: "member" }));
    const s = await seatStatus(ORG);
    expect(s.limit).toBe(Infinity);
    expect(s.available).toBe(true);
  });

  it("counts only the target org's memberships, not another org's", async () => {
    state.orgs.push({ id: "org-2", plan: "starter", trial_ends_at: null });
    state.memberships.push({ org_id: "org-2", user_id: "u9", role: "owner" }, { org_id: "org-2", user_id: "u10", role: "member" });
    const s = await seatStatus(ORG);
    expect(s.used).toBe(1); // org-1 still has just its own owner
  });
});

describe("inviteMember seat pre-check", () => {
  it("refuses to invite once the plan's seat limit is reached", async () => {
    const result = await inviteMember(ORG, "owner", "new@acme.com", "member");
    expect(result).toEqual({ ok: false, error: "Seat limit reached (1/1). Remove a member or upgrade your plan to invite more." });
  });

  it("allows the invite when a seat is free", async () => {
    state.orgs[0].plan = "starter";
    const result = await inviteMember(ORG, "owner", "new@acme.com", "member");
    expect(result).toEqual({ ok: true });
  });
});

describe("attachMembership (SSO provisioning) seat enforcement", () => {
  it("refuses to add a NEW member once the org is at its seat limit", async () => {
    const attached = await attachMembership(ORG, "u-new", "member");
    expect(attached).toBe(false);
    expect(state.memberships.find((m) => m.user_id === "u-new")).toBeUndefined();
  });

  it("never refuses an EXISTING member, even at the limit — SSO logs in the same owner every day", async () => {
    const attached = await attachMembership(ORG, "u1", "owner");
    expect(attached).toBe(true);
  });

  it("adds a new member when a seat is free", async () => {
    state.orgs[0].plan = "starter";
    const attached = await attachMembership(ORG, "u-new", "member");
    expect(attached).toBe(true);
    expect(state.memberships.find((m) => m.user_id === "u-new")).toBeDefined();
  });
});
