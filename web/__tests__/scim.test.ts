/**
 * SCIM deprovisioning must not be able to strand an organisation.
 *
 * An identity provider is authoritative about employment, not about who owns a
 * workspace. If the last owner leaves the IdP group, the correct outcome is a
 * refusal the admin can see — not an org with no one able to administer it,
 * rotate keys, or release a legal hold.
 *
 * Also pins the rule that deprovisioning removes the MEMBERSHIP and not the
 * user: the user row is referenced by audit history, which has to stay
 * readable after someone leaves. An audit entry that becomes anonymous at
 * offboarding is worthless precisely when it is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  users: { id: string; email: string; name: string | null }[];
  memberships: { org_id: string; user_id: string; role: string }[];
  deletedUsers: string[];
} = { users: [], memberships: [], deletedUsers: [] };

vi.mock("@/lib/adminAudit", () => ({ logAdminAction: async () => true }));

vi.mock("@/lib/supabase/admin", () => {
  const build = (table: string) => {
    const f: Record<string, unknown> = {};
    const api: Record<string, unknown> = {};
    let op: "select" | "delete" | "insert" | "upsert" = "select";
    api.select = () => api;
    api.eq = (c: string, v: unknown) => { f[c] = v; return api; };
    api.insert = (row: Record<string, unknown>) => {
      op = "insert";
      if (table === "users") state.users.push({ id: `u${state.users.length + 1}`, email: row.email as string, name: (row.name as string) ?? null });
      if (table === "memberships") state.memberships.push(row as { org_id: string; user_id: string; role: string });
      return api;
    };
    api.upsert = () => { op = "upsert"; return api; };
    api.delete = () => { op = "delete"; return api; };
    api.single = async () => ({ data: state.users[state.users.length - 1], error: null });
    api.maybeSingle = async () => {
      if (table === "users") {
        const u = state.users.find((x) => (f.email ? x.email === f.email : x.id === f.id));
        return { data: u ?? null, error: null };
      }
      const m = state.memberships.find((x) => x.org_id === f.org_id && x.user_id === f.user_id);
      return { data: m ?? null, error: null };
    };
    const result = () => {
      if (op === "delete") {
        if (table === "memberships") {
          state.memberships = state.memberships.filter((x) => !(x.org_id === f.org_id && x.user_id === f.user_id));
        }
        if (table === "users") state.deletedUsers.push(f.id as string);
        return { data: null, error: null };
      }
      if (table === "memberships" && f.role) {
        return { data: null, error: null, count: state.memberships.filter((m) => m.org_id === f.org_id && m.role === f.role).length };
      }
      return { data: [], error: null };
    };
    api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    api.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result()).catch(fn);
    return api;
  };
  return { getAdminClient: () => ({ from: (t: string) => build(t) }) };
});

const { scimSetActive } = await import("@/lib/scim");

const ORG = "org-1";

beforeEach(() => {
  state.users = [
    { id: "u1", email: "owner@acme.com", name: "Owner" },
    { id: "u2", email: "member@acme.com", name: "Member" },
  ];
  state.memberships = [
    { org_id: ORG, user_id: "u1", role: "owner" },
    { org_id: ORG, user_id: "u2", role: "member" },
  ];
  state.deletedUsers = [];
});

describe("SCIM deprovisioning", () => {
  it("removes a member's access", async () => {
    const ok = await scimSetActive(ORG, "u2", false);
    expect(ok).toBe(true);
    expect(state.memberships.some((m) => m.user_id === "u2")).toBe(false);
  });

  it("refuses to deprovision the last owner", async () => {
    await expect(scimSetActive(ORG, "u1", false)).rejects.toThrow(/last owner/i);
    expect(state.memberships.some((m) => m.user_id === "u1")).toBe(true);
  });

  it("allows deprovisioning an owner when another remains", async () => {
    state.memberships.push({ org_id: ORG, user_id: "u3", role: "owner" });
    const ok = await scimSetActive(ORG, "u1", false);
    expect(ok).toBe(true);
    expect(state.memberships.some((m) => m.user_id === "u1")).toBe(false);
  });

  it("keeps the user row so audit history stays attributable", async () => {
    await scimSetActive(ORG, "u2", false);
    expect(state.deletedUsers).toEqual([]);
    expect(state.users.some((u) => u.id === "u2")).toBe(true);
  });

  it("returns false for someone who was never in the org", async () => {
    expect(await scimSetActive(ORG, "nobody", false)).toBe(false);
  });
});
