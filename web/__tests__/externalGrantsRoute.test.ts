import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for a bug found in an adversarial QA pass on external
 * auditor/regulator grants: web/lib/externalGrants.ts's GrantScopeType
 * includes "control_ids" as groundwork for a future compliance-narrative
 * grant, and grantCoversRun()/resolveExternalGrantForRun() correctly always
 * reject it (see web/lib/__tests__/externalGrants.test.ts) — but nothing
 * anywhere ever RESOLVES a control_ids-scoped grant successfully either (no
 * route consumes it). Before this fix, POST /api/app/external-grants still
 * accepted scope_type="control_ids" and happily issued a real API key for it
 * — a credential that would 401 on every single endpoint forever, with no
 * signal to the issuing admin that anything was wrong. This test locks in
 * that the issuance route rejects it until a real consumer exists.
 */

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "u1", email: "admin@example.com", orgId: "org1", role: "admin" }),
  atLeast: () => true,
}));
vi.mock("@/lib/planGate", () => ({
  orgHasFeature: vi.fn().mockResolvedValue(true),
}));
const issueExternalGrant = vi.fn();
vi.mock("@/lib/externalGrants", () => ({
  issueExternalGrant,
  listExternalGrants: vi.fn(),
}));

describe("POST /api/app/external-grants", () => {
  beforeEach(() => {
    issueExternalGrant.mockClear();
  });

  it("rejects scope_type=control_ids — no route resolves it, so issuing one would be a dead credential", async () => {
    const { POST } = await import("../app/api/app/external-grants/route");
    const req = new Request("http://x/api/app/external-grants", {
      method: "POST",
      body: JSON.stringify({ label: "auditor", scope_type: "control_ids", control_ids: ["eu-art-12-1"], expires_in_days: 30 }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/scope_type must be one of/);
    expect(issueExternalGrant).not.toHaveBeenCalled();
  });

  it("still accepts scope_type=run_ids", async () => {
    issueExternalGrant.mockResolvedValueOnce({ apiKey: "rb_grant_x", grant: { id: "g1" } });
    const { POST } = await import("../app/api/app/external-grants/route");
    const req = new Request("http://x/api/app/external-grants", {
      method: "POST",
      body: JSON.stringify({ label: "auditor", scope_type: "run_ids", run_ids: ["run-1"], expires_in_days: 30 }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(issueExternalGrant).toHaveBeenCalled();
  });

  it("still accepts scope_type=org_wide", async () => {
    issueExternalGrant.mockResolvedValueOnce({ apiKey: "rb_grant_y", grant: { id: "g2" } });
    const { POST } = await import("../app/api/app/external-grants/route");
    const req = new Request("http://x/api/app/external-grants", {
      method: "POST",
      body: JSON.stringify({ label: "auditor", scope_type: "org_wide", expires_in_days: 30 }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(issueExternalGrant).toHaveBeenCalled();
  });
});
