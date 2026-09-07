/**
 * SIEM export — wire format and endpoint safety.
 *
 * The format matters more than it looks. Splunk's HEC rejects a JSON array:
 * it expects newline-delimited objects, each wrapping the payload in `event`.
 * Sending the wrong shape produces a 400 that looks like an auth problem, and
 * the feed silently carries nothing — the exact failure this feature exists to
 * prevent, made harder to notice because the config appears correct.
 *
 * Endpoint safety is pinned here too: audit events name people, IP addresses
 * and the targets they touched, and must never leave over plain HTTP.
 */
import { describe, it, expect } from "vitest";
import { renderBatch, toCommonEvent, assertSafeEndpoint } from "@/lib/siem";
import type { AdminEvent } from "@/lib/adminAudit";

const event = (over: Partial<AdminEvent> = {}): AdminEvent => ({
  seq: 7,
  event_id: "11111111-1111-1111-1111-111111111111",
  actor_kind: "user",
  actor_email: "admin@acme.com",
  actor_label: "An Admin",
  action: "member.remove",
  target_type: "user",
  target_id: "u2",
  metadata: { previous_role: "admin" },
  ip: "203.0.113.7",
  created_at: "2026-08-01T10:00:00.000Z",
  entry_hash: "e".repeat(64),
  prev_hash: "p".repeat(64),
  leaf_hash: "l".repeat(64),
  ...over,
});

describe("common event shape", () => {
  it("carries who, what, where and the chain hashes", () => {
    const c = toCommonEvent("org-1", event());
    expect(c.event_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(c.org_id).toBe("org-1");
    expect(c.action).toBe("member.remove");
    expect(c.actor).toEqual({ kind: "user", email: "admin@acme.com", label: "An Admin" });
    expect(c.source_ip).toBe("203.0.113.7");
    // Lets the SIEM prove the feed was not altered in transit or at rest.
    expect(c.integrity.entry_hash).toBe("e".repeat(64));
  });
});

describe("Splunk HEC format", () => {
  it("emits newline-delimited objects, not a JSON array", () => {
    const body = renderBatch("splunk_hec", "org-1", [event({ seq: 1 }), event({ seq: 2 })]);
    expect(body.startsWith("[")).toBe(false);
    const lines = body.split("\n");
    expect(lines).toHaveLength(2);
    expect(() => lines.map((l) => JSON.parse(l))).not.toThrow();
  });

  it("wraps the payload in `event` with an epoch-seconds `time`", () => {
    const parsed = JSON.parse(renderBatch("splunk_hec", "org-1", [event()]));
    expect(parsed.sourcetype).toBe("runback:admin_audit");
    expect(parsed.time).toBe(Math.floor(Date.parse("2026-08-01T10:00:00.000Z") / 1000));
    expect(parsed.event.action).toBe("member.remove");
  });
});

describe("Sentinel and generic webhook format", () => {
  it("sends a JSON array", () => {
    for (const kind of ["sentinel", "webhook"] as const) {
      const parsed = JSON.parse(renderBatch(kind, "org-1", [event({ seq: 1 }), event({ seq: 2 })]));
      expect(Array.isArray(parsed), kind).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].log_type).toBe("runback_admin_audit");
    }
  });
});

describe("endpoint safety", () => {
  it("accepts HTTPS", () => {
    expect(() => assertSafeEndpoint("https://http-inputs-acme.splunkcloud.com/services/collector")).not.toThrow();
  });

  it("rejects plain HTTP — audit events name people and IPs", () => {
    expect(() => assertSafeEndpoint("http://collector.internal/ingest")).toThrow(/HTTPS/i);
  });

  it("rejects a non-URL", () => {
    expect(() => assertSafeEndpoint("collector.internal")).toThrow(/valid URL/i);
  });
});
