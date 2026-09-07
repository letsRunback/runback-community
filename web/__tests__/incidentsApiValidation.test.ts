/**
 * Adversarial-input validation for the incidents API routes.
 *
 * `IncidentStatus`/`IncidentSeverity` are compile-time-only guarantees — a
 * direct API call sends untyped JSON, and both createIncident() and
 * updateIncident() used to write whatever string arrived. An unrecognized
 * status is not cosmetic: IncidentActions.tsx only renders a "Start
 * investigating" / "Mark remediated" / "Close incident" button for the four
 * known statuses, so an incident saved with e.g. status: "foo" rendered with
 * NO action buttons at all — a dead end in the same family as the prior
 * one-way status-transition trap this codebase already had. These routes now
 * reject unknown status/severity values before they're ever written.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/apiAuth", () => ({
  getCaller: vi.fn(async () => ({ orgId: "org1", email: "a@b.com", userId: "u1", role: "admin", via: "session" })),
  actorLabel: () => "a@b.com",
}));
vi.mock("@/lib/planGate", () => ({
  orgHasFeature: vi.fn(async () => true),
}));
vi.mock("@/lib/incidents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/incidents")>("@/lib/incidents");
  return {
    ...actual,
    createIncident: vi.fn(async () => ({ id: "inc1" })),
    updateIncident: vi.fn(async () => ({ ok: true, incident: { id: "inc1" } })),
    listIncidents: vi.fn(async () => []),
  };
});

import { POST as createRoute, GET as listRoute } from "@/app/api/incidents/route";
import { PATCH as patchRoute } from "@/app/api/incidents/[id]/route";

function req(body: unknown, url = "http://x/api/incidents") {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/incidents — severity validation", () => {
  it("rejects an unrecognized severity", async () => {
    const res = await createRoute(req({ run_id: "run1", severity: "apocalyptic" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it.each(["low", "medium", "high", "critical"])("accepts severity %s", async (severity) => {
    const res = await createRoute(req({ run_id: "run1", severity }));
    expect(res.status).toBe(200);
  });

  it("accepts a request with no severity (defaults downstream)", async () => {
    const res = await createRoute(req({ run_id: "run1" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/incidents — status query validation", () => {
  it("rejects an unrecognized status filter", async () => {
    const res = await listRoute(new NextRequest("http://x/api/incidents?status=archived"));
    expect(res.status).toBe(400);
  });

  it.each(["open", "investigating", "remediated", "closed"])("accepts status=%s", async (status) => {
    const res = await listRoute(new NextRequest(`http://x/api/incidents?status=${status}`));
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/incidents/[id] — status/severity validation", () => {
  const params = Promise.resolve({ id: "inc1" });

  it("rejects an unrecognized status instead of writing a dead-end value", async () => {
    const res = await patchRoute(req({ status: "archived" }), { params });
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognized severity", async () => {
    const res = await patchRoute(req({ severity: "meh" }), { params });
    expect(res.status).toBe(400);
  });

  // updateIncident is mocked in this file (see vi.mock above), so this only
  // proves the route accepts each ENUM value as valid input shape — it does
  // NOT prove transition legality, which is a property of updateIncident()
  // itself and is tested unmocked, against real transition logic, in
  // incidentTransitions.test.ts.
  it.each(["open", "investigating", "remediated", "closed"])("accepts status=%s as a well-formed enum value", async (status) => {
    const res = await patchRoute(req({ status }), { params });
    expect(res.status).toBe(200);
  });
});
