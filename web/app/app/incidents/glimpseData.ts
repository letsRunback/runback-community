import type { IncidentRow } from "@/lib/incidents";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a working incident queue (and detail page) looks like, not an empty
// list. Same fixture backs both /app/incidents and /app/incidents/[id] so a
// click-through from the glimpse list lands on a matching glimpse detail.
const HOUR = 3_600_000;

export const GLIMPSE_INCIDENTS: IncidentRow[] = [
  {
    id: "glimpse-1",
    org_id: "glimpse",
    run_id: "run_8f2a1c",
    run_name: "loan-approval-agent",
    title: "PII redaction policy blocked run",
    status: "open",
    severity: "critical",
    root_cause: "Agent attempted to include an unredacted SSN in an outbound email — policy blocked the send before it left the fleet.",
    remediation: null,
    golden_run_id: null,
    timeline: [
      { at: new Date(Date.now() - 2 * HOUR).toISOString(), actor: "system", event: "incident_opened", note: "Auto-opened from policy block" },
    ],
    created_by: "system",
    created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    updated_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    closed_at: null,
  },
  {
    id: "glimpse-2",
    org_id: "glimpse",
    run_id: "run_3e91bb",
    run_name: "fraud-detection-agent",
    title: "Cost threshold exceeded mid-run",
    status: "investigating",
    severity: "high",
    root_cause: "A retry loop triggered by a malformed tool response caused 4x the expected token usage.",
    remediation: null,
    golden_run_id: null,
    timeline: [
      { at: new Date(Date.now() - 26 * HOUR).toISOString(), actor: "system", event: "incident_opened", note: "Auto-opened from policy block" },
      { at: new Date(Date.now() - 24 * HOUR).toISOString(), actor: "oncall@yourco.com", event: "status_changed_to_investigating" },
    ],
    created_by: "system",
    created_at: new Date(Date.now() - 26 * HOUR).toISOString(),
    updated_at: new Date(Date.now() - 24 * HOUR).toISOString(),
    closed_at: null,
  },
  {
    id: "glimpse-3",
    org_id: "glimpse",
    run_id: "run_c04d77",
    run_name: "support-agent",
    title: "Internal doc link leaked in response",
    status: "remediated",
    severity: "medium",
    root_cause: "Missing output-filter policy for internal URLs allowed a private doc link through to the customer.",
    remediation: "Added an output policy blocking internal-domain links; enrolled the triggering run as a regression test.",
    golden_run_id: "run_c04d77_golden",
    timeline: [
      { at: new Date(Date.now() - 9 * 24 * HOUR).toISOString(), actor: "system", event: "incident_opened", note: "Auto-opened from policy block" },
      { at: new Date(Date.now() - 9 * 24 * HOUR).toISOString(), actor: "oncall@yourco.com", event: "status_changed_to_investigating" },
      { at: new Date(Date.now() - 8 * 24 * HOUR).toISOString(), actor: "oncall@yourco.com", event: "status_changed_to_remediated", note: "Output policy shipped" },
    ],
    created_by: "system",
    created_at: new Date(Date.now() - 9 * 24 * HOUR).toISOString(),
    updated_at: new Date(Date.now() - 8 * 24 * HOUR).toISOString(),
    closed_at: null,
  },
];
