import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for a docs/code mismatch found in an adversarial QA pass:
 * the docs (web/app/docs/page.tsx, "feat-narratives" and the api-narratives
 * table) promise that GET /api/runs/:run_id/narrative returns "each [narrative]
 * with a live re-verification verdict" — the same "verified against current
 * evidence" / "evidence changed since sealed" badge the compliance-control
 * narrative GET (web/app/api/regulatory/[framework_id]/[control_id]/
 * narrative/route.ts) and the security-findings GET
 * (web/app/api/runs/[run_id]/security-findings/route.ts) both compute via
 * verifyStoredNarrative/verifyStoredFinding per row.
 *
 * The run-narrative GET previously just returned raw getNarrativesForRun()
 * rows with no `verification` field at all — the UI's NarrativeButton could
 * never show the badge the docs describe, and any API consumer following the
 * docs' documented response shape would get an unexpected shape back. This
 * test locks in that every row in the response carries a `verification`
 * object.
 */

const NARRATIVE_ROW = {
  id: "n1",
  org_id: "org1",
  run_id: "run1",
  subject: "model_diff",
  subject_ref: "gpt-4:gpt-4o:30",
  content_digest: "digest-current",
  model_id: "demo-simulated",
  prompt: {},
  output: { narrative: "because X" },
  payload_hash: "ph",
  prev_hash: "",
  entry_hash: "eh",
  signature: { alg: "HMAC-SHA256", value: "sig" },
  created_at: "2024-01-01T00:00:00.000Z",
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "u1", email: "user@example.com", orgId: "org1" }),
}));
vi.mock("@/lib/planGate", () => ({
  orgHasFeature: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/demoMode", () => ({
  DEMO_MODE: false,
  isDemoEmail: () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { org_id: "org1", cassette_digest: "digest-current" } }),
        }),
      }),
    }),
  }),
}));
const getNarrativesForRun = vi.fn().mockResolvedValue([NARRATIVE_ROW]);
const verifyStoredNarrative = vi.fn().mockReturnValue({
  chainValid: true,
  payloadValid: true,
  signatureVerdict: "valid",
  digestMatches: true,
  verified: true,
});
vi.mock("@/lib/narratives", () => ({
  appendNarrative: vi.fn(),
  getNarrativesForRun,
  verifyStoredNarrative,
}));

describe("GET /api/runs/:run_id/narrative", () => {
  // vitest.config.ts sets restoreMocks: true, which restores every mock's
  // implementation (not just call history) before each test — including
  // the mockResolvedValue/mockReturnValue set at module scope above. Without
  // re-establishing them here, the mocks silently become no-ops and the
  // route sees `undefined` instead of the fixture data.
  beforeEach(() => {
    getNarrativesForRun.mockResolvedValue([NARRATIVE_ROW]);
    verifyStoredNarrative.mockReturnValue({
      chainValid: true,
      payloadValid: true,
      signatureVerdict: "valid",
      digestMatches: true,
      verified: true,
    });
  });

  it("attaches a live re-verification verdict to every returned narrative, as documented", async () => {
    const { GET } = await import("../app/api/runs/[run_id]/narrative/route");
    const req = new Request("http://x/api/runs/run1/narrative");
    const res = await GET(req as never, { params: Promise.resolve({ run_id: "run1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.narratives).toHaveLength(1);
    expect(body.narratives[0].verification).toBeDefined();
    expect(body.narratives[0].verification.verified).toBe(true);

    // Re-verification must be checked against the run's CURRENT digest, not
    // just the chain/signature in isolation — the whole point of the badge.
    expect(verifyStoredNarrative).toHaveBeenCalledWith(NARRATIVE_ROW, "digest-current");
  });
});
