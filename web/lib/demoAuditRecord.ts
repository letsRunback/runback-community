/**
 * The audit record shown on the public /verify page's "Use demo record" tab.
 *
 * This is a REAL record, not a mock-up: it is built by the same
 * buildAuditRecordFromEvents() that produces a customer's export, so its hash
 * chain, cassette digest and signature are genuine and it verifies through the
 * exact same /api/audit/verify call a pasted export does. The page's whole claim
 * is that you can verify a record independently — a demo record that could not
 * survive its own verifier would make that claim false.
 *
 * Deliberately built from a fixed in-memory run (no DB read): /verify is public
 * and must not expose any tenant's real run, and the record must be identical on
 * every deploy so the page is stable.
 */
import { buildAuditRecordFromEvents, type AuditRecord } from "@/lib/audit";
import type { TraceEvent } from "@runback/schema";
import type { RunRow } from "@/lib/runs";

// A frozen instant — the record must be byte-identical across renders and
// deploys, so nothing here may read the clock.
const T0 = "2026-06-14T02:47:11.000Z";
const T1 = "2026-06-14T02:47:12.400Z";
const T2 = "2026-06-14T02:47:12.618Z";
const T3 = "2026-06-14T02:47:13.900Z";
const T4 = "2026-06-14T02:47:13.950Z";

const RUN_ID = "run_a3f1b90c";

const DEMO_RUN: RunRow = {
  run_id: RUN_ID,
  name: "loan-approval-agent",
  status: "error",
  input: "Applicant #4471 requests a $12,000 personal loan.",
  output: null,
  error: { name: "PolicyBlock", message: "issue_approval blocked — manual-review-required" },
  metadata: { demo: true },
  step_count: 2,
  total_tokens: 1030,
  started_at: T0,
  ended_at: T4,
  actor_type: null,
  actor_id: null,
};

const DEMO_EVENTS: TraceEvent[] = [
  {
    schema_version: 1,
    run_id: RUN_ID,
    span_id: "r",
    parent_span_id: null,
    seq: 0,
    ts_start: T0,
    ts_end: null,
    type: "run",
    phase: "start",
    name: "loan-approval-agent",
    input: "Applicant #4471 requests a $12,000 personal loan.",
    output: null,
    status: "running",
    error: null,
    metadata: { demo: true },
  },
  {
    schema_version: 1,
    run_id: RUN_ID,
    span_id: "l1",
    parent_span_id: "r",
    seq: 1,
    ts_start: T0,
    ts_end: T1,
    type: "llm",
    model: { provider: "openai", model_id: "gpt-4o" },
    request: {
      system: "You are a careful lending agent. Follow policy.",
      messages: [
        { role: "user", content: "Applicant #4471 requests a $12,000 personal loan." },
      ],
      tools: [
        {
          name: "check_credit_file",
          description: "Pull the applicant's credit file.",
          parameters: { type: "object", properties: { applicant_id: { type: "number" } } },
        },
      ],
      params: { temperature: 0 },
    },
    response: {
      text: "Checking the credit file before deciding.",
      reasoning: null,
      finish_reason: "tool-call",
      tool_calls: [
        { tool_call_id: "t1", tool_name: "check_credit_file", input: { applicant_id: 4471 } },
      ],
    },
    usage: { input_tokens: 428, output_tokens: 184, total_tokens: 612 },
    latency_ms: 1400,
    error: null,
  },
  {
    schema_version: 1,
    run_id: RUN_ID,
    span_id: "t1",
    parent_span_id: "l1",
    seq: 2,
    ts_start: T1,
    ts_end: T2,
    type: "tool",
    tool_name: "check_credit_file",
    tool_call_id: "t1",
    input: { applicant_id: 4471 },
    output: { score: 684, band: "near-prime", disputes_open: 1 },
    latency_ms: 218,
    error: null,
  },
  {
    schema_version: 1,
    run_id: RUN_ID,
    span_id: "l2",
    parent_span_id: "r",
    seq: 3,
    ts_start: T2,
    ts_end: T3,
    type: "llm",
    model: { provider: "openai", model_id: "gpt-4o" },
    request: {
      system: "You are a careful lending agent. Follow policy.",
      messages: [
        { role: "user", content: "Applicant #4471 requests a $12,000 personal loan." },
        { role: "tool", content: '{"score":684,"band":"near-prime","disputes_open":1}' },
      ],
      tools: [
        {
          name: "issue_approval",
          description: "Approve the loan.",
          parameters: { type: "object", properties: { amount: { type: "number" } } },
        },
      ],
      params: { temperature: 0 },
    },
    response: {
      text: "Credit is sufficient — approving.",
      reasoning: null,
      finish_reason: "tool-call",
      tool_calls: [
        { tool_call_id: "t2", tool_name: "issue_approval", input: { applicant_id: 4471, amount: 12000 } },
      ],
    },
    usage: { input_tokens: 286, output_tokens: 132, total_tokens: 418 },
    latency_ms: 1282,
    error: null,
  },
  {
    schema_version: 1,
    run_id: RUN_ID,
    span_id: "t2",
    parent_span_id: "l2",
    seq: 4,
    ts_start: T3,
    ts_end: T4,
    type: "tool",
    tool_name: "issue_approval",
    tool_call_id: "t2",
    input: { applicant_id: 4471, amount: 12000 },
    output: null,
    latency_ms: 50,
    error: { name: "PolicyBlock", message: "Blocked: an open dispute requires manual review before approval." },
    policy_block: {
      rule: "manual-review-required",
      detail: "when credit_file.disputes_open gt 0 → must call escalate_to_human",
    },
    policy_evaluated: { passed: false },
  },
  {
    schema_version: 1,
    run_id: RUN_ID,
    span_id: "re",
    parent_span_id: null,
    seq: 5,
    ts_start: T4,
    ts_end: T4,
    type: "run",
    phase: "end",
    name: "loan-approval-agent",
    input: null,
    output: null,
    status: "error",
    error: { name: "PolicyBlock", message: "issue_approval blocked — manual-review-required" },
    metadata: {},
  },
];

/**
 * Build the demo record. Not memoized across requests on purpose: sign() reads
 * AUDIT_SIGNING_KEY / AUDIT_ED25519_PRIVATE_KEY at call time, so a key rotation
 * takes effect without a rebuild.
 */
export function demoAuditRecord(): AuditRecord {
  return buildAuditRecordFromEvents(RUN_ID, DEMO_RUN, DEMO_EVENTS, T4);
}
