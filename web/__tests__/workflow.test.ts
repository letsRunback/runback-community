/**
 * Workflow integrations fail in two ways that both look like "it's configured
 * but nothing happens", so both are pinned here.
 *
 * WRONG PAYLOAD. Each vendor has a shape, and getting it wrong returns a 4xx
 * that reads like a permissions problem. Jira Cloud v3 is the sharpest: it
 * requires Atlassian Document Format for `description` and rejects a plain
 * string, so an otherwise-correct integration silently never creates an issue.
 * ServiceNow urgency is 1..3, not "high". PagerDuty has a fixed severity
 * vocabulary that does not include "normal".
 *
 * WRONG VOLUME. A policy misconfiguration blocking every call would open a
 * ticket per occurrence. The integration gets switched off within a day — the
 * same outcome as never building it, with the customer's goodwill spent.
 */
import { describe, it, expect } from "vitest";
import { buildRequest, toAdf, externalRef, wants, type WorkflowSink, type Finding } from "@/lib/workflow";

const sink = (over: Partial<WorkflowSink> = {}): WorkflowSink => ({
  id: "s1", org_id: "o1", kind: "servicenow", endpoint: "https://acme.service-now.com",
  project_key: null, enabled: true,
  on_ledger_tamper: true, on_critical_gap: true, on_shadow_agent: true, on_sdk_bypass: true, on_policy_block: false,
  policy_block_threshold: 25, last_ok_at: null, last_error: null, ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  kind: "ledger_tamper",
  dedupeKey: "ledger_tamper:seq-15",
  title: "Audit ledger verification failed",
  detail: "Tamper detected at seq 15.",
  urgency: "critical",
  link: "https://runback.dev/app/ledger",
  ...over,
});

describe("ServiceNow", () => {
  it("posts to the table API with numeric urgency", () => {
    const r = buildRequest(sink({ project_key: "incident" }), finding(), "user:pass");
    expect(r.url).toBe("https://acme.service-now.com/api/now/table/incident");
    const b = JSON.parse(r.body);
    expect(b.short_description).toBe("Audit ledger verification failed");
    // "critical" would be rejected — ServiceNow wants 1..3.
    expect(b.urgency).toBe("1");
    expect(b.correlation_id).toBe("ledger_tamper:seq-15");
    expect(r.headers.authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  it("tolerates a trailing slash on the instance URL", () => {
    const r = buildRequest(sink({ endpoint: "https://acme.service-now.com/" }), finding(), null);
    expect(r.url).not.toContain("//api");
  });
});

describe("Jira", () => {
  it("sends the description as Atlassian Document Format, not a string", () => {
    const r = buildRequest(sink({ kind: "jira", endpoint: "https://acme.atlassian.net", project_key: "RISK" }), finding(), "a@b.c:token");
    expect(r.url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    const b = JSON.parse(r.body);
    expect(typeof b.fields.description).toBe("object");
    expect(b.fields.description.type).toBe("doc");
    expect(b.fields.description.version).toBe(1);
    expect(b.fields.project.key).toBe("RISK");
  });

  it("puts the Runback link in the body so the record is actionable", () => {
    const r = buildRequest(sink({ kind: "jira", project_key: "RISK" }), finding(), null);
    expect(JSON.stringify(JSON.parse(r.body).fields.description)).toContain("runback.dev/app/ledger");
  });

  it("builds valid ADF from multi-line text", () => {
    const doc = toAdf("line one\n\nline two");
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].content[0].text).toBe("line one");
  });
});

describe("PagerDuty", () => {
  it("maps urgency onto PagerDuty's vocabulary and sets a dedup key", () => {
    const r = buildRequest(sink({ kind: "pagerduty" }), finding({ urgency: "normal" }), "ROUTING_KEY");
    expect(r.url).toBe("https://events.pagerduty.com/v2/enqueue");
    const b = JSON.parse(r.body);
    expect(b.routing_key).toBe("ROUTING_KEY");
    // "normal" is not a PagerDuty severity.
    expect(b.payload.severity).toBe("warning");
    expect(b.dedup_key).toBe("ledger_tamper:seq-15");
  });
});

describe("response parsing", () => {
  it("extracts the record identifier for the link back", () => {
    expect(externalRef("servicenow", { result: { number: "INC0012345" } }).id).toBe("INC0012345");
    expect(externalRef("jira", { key: "RISK-42" }).id).toBe("RISK-42");
    expect(externalRef("pagerduty", { dedup_key: "abc" }).id).toBe("abc");
  });

  it("returns null rather than throwing on an unexpected body", () => {
    expect(externalRef("servicenow", {}).id).toBeNull();
    expect(externalRef("jira", null).id).toBeNull();
  });
});

describe("which findings raise a record", () => {
  it("raises tamper, critical gaps, shadow agents, and sdk bypasses by default", () => {
    expect(wants(sink(), finding({ kind: "ledger_tamper" }))).toBe(true);
    expect(wants(sink(), finding({ kind: "critical_gap" }))).toBe(true);
    expect(wants(sink(), finding({ kind: "shadow_agent" }))).toBe(true);
    expect(wants(sink(), finding({ kind: "sdk_bypass" }))).toBe(true);
  });

  it("respects on_shadow_agent when turned off", () => {
    expect(wants(sink({ on_shadow_agent: false }), finding({ kind: "shadow_agent" }))).toBe(false);
  });

  it("respects on_sdk_bypass when turned off", () => {
    expect(wants(sink({ on_sdk_bypass: false }), finding({ kind: "sdk_bypass" }))).toBe(false);
  });

  it("does not raise routine policy blocks unless asked", () => {
    expect(wants(sink(), finding({ kind: "policy_block" }), 500)).toBe(false);
  });

  it("raises policy blocks only past the threshold", () => {
    const s = sink({ on_policy_block: true, policy_block_threshold: 25 });
    expect(wants(s, finding({ kind: "policy_block" }), 24)).toBe(false);
    expect(wants(s, finding({ kind: "policy_block" }), 25)).toBe(true);
  });

  it("raises nothing when the sink is disabled", () => {
    expect(wants(sink({ enabled: false }), finding())).toBe(false);
  });
});
