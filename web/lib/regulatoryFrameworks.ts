/**
 * Regulatory framework clause maps — the static definition of which named
 * controls (EU AI Act, ISO 42001, NIST AI RMF, APRA CPS 230/234, GDPR,
 * ISO 27001) Runback's evidence can satisfy, and the requirement text for
 * each.
 *
 * Pure data plus lookups over it — no org, no database, no entitlement. Split
 * out of the former lib/regulatory.ts because the PUBLIC marketing pages
 * (/regulatory, /regulatory/[framework], sitemap.ts) are built from exactly
 * this, while the live per-org compliance dashboard that evaluates these
 * definitions against real run data is a licensed feature and now lives in
 * lib/enterprise/regulatory.ts. Both read the same definitions, so a public
 * page describes the real in-app mapping rather than a marketing summary
 * of it.
 */
import { VERTICALS, type Vertical } from "@/lib/verticals";

export type FrameworkId = "eu_ai_act" | "iso_42001" | "nist_ai_rmf" | "apra_cps230" | "gdpr" | "iso_27001" | "apra_cps234";
export type ControlStatus = "compliant" | "partial" | "not_started";

export interface RegulatoryControl {
  id: string;            // e.g. "eu-art-9-1"
  clause: string;        // e.g. "Article 9(1)"
  requirement: string;   // verbatim or paraphrased requirement text
  runback_capability: string;   // which Runback feature covers it
  evidence_type: string; // "audit_log" | "policy_block" | "ledger" | "report"
  status: ControlStatus;
  evidence_count: number; // e.g. number of policy blocks or ledger entries
  evidence_link?: string; // deep link to the evidence in the app
}

export interface FrameworkReport {
  framework_id: FrameworkId;
  framework_name: string;
  version: string;
  controls: RegulatoryControl[];
  compliant_count: number;
  partial_count: number;
  not_started_count: number;
  overall_pct: number; // (compliant + 0.5*partial) / total
  generated_at: string;
  /** True when this framework's real regulatory scope covers the org's declared industry. */
  recommended: boolean;
}

export interface RegulatoryOverview {
  frameworks: FrameworkReport[];
  org_id: string;
  generated_at: string;
}

// Static control definitions — status is computed at runtime from live data
const EU_AI_ACT_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "eu-art-9-1",  clause: "Article 9(1)",   requirement: "Establish, implement, document, and maintain a risk management system for the AI system.", runback_capability: "Policy engine + audit ledger", evidence_type: "policy_block", evidence_link: "/app/policies" },
  { id: "eu-art-9-7",  clause: "Article 9(7)",   requirement: "The risk management system shall include appropriate testing procedures for high-risk AI systems.", runback_capability: "Golden test suite + Upgrade gate", evidence_type: "audit_log", evidence_link: "/app/golden" },
  { id: "eu-art-12-1", clause: "Article 12(1)",  requirement: "High-risk AI systems shall be designed and developed with capabilities enabling the automatic recording of events.", runback_capability: "Immutable run ledger (Merkle-chained)", evidence_type: "ledger", evidence_link: "/app/ledger" },
  { id: "eu-art-12-2", clause: "Article 12(2)",  requirement: "Logging capabilities shall ensure traceability of the AI system's functioning throughout its lifetime.", runback_capability: "Full cassette replay + audit trace", evidence_type: "audit_log", evidence_link: "/app/runs" },
  { id: "eu-art-13-1", clause: "Article 13(1)",  requirement: "High-risk AI systems shall be transparent and provide information enabling users to interpret the output.", runback_capability: "Decision trace + policy block explanation", evidence_type: "audit_log", evidence_link: "/app/runs" },
  { id: "eu-art-14-1", clause: "Article 14(1)",  requirement: "High-risk AI systems shall be designed to allow natural persons to effectively oversee their functioning.", runback_capability: "Policy engine with human-override hooks", evidence_type: "policy_block", evidence_link: "/app/policies" },
  { id: "eu-art-17-1", clause: "Article 17(1)",  requirement: "Providers of high-risk AI systems shall implement a quality management system.", runback_capability: "Eval suite + fleet benchmarks + compliance report", evidence_type: "report", evidence_link: "/app/compliance" },
];

const ISO_42001_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "iso-6-1",    clause: "6.1",   requirement: "Actions to address risks and opportunities in the AI management system.", runback_capability: "Risk dashboard + policy engine", evidence_type: "policy_block", evidence_link: "/app/policies" },
  { id: "iso-8-4",    clause: "8.4",   requirement: "Assessment of AI system impacts — maintain documented information of AI system impacts.", runback_capability: "Compliance artifact download + ledger", evidence_type: "ledger", evidence_link: "/app/compliance" },
  { id: "iso-9-1",    clause: "9.1",   requirement: "Monitoring, measurement, analysis, and evaluation of AI system performance.", runback_capability: "Fleet benchmarks + error rate tracking", evidence_type: "audit_log", evidence_link: "/app/benchmark" },
  { id: "iso-9-3",    clause: "9.3",   requirement: "Management review of the AI management system at planned intervals.", runback_capability: "Compliance report export (machine-readable)", evidence_type: "report", evidence_link: "/app/compliance" },
  { id: "iso-10-2",   clause: "10.2",  requirement: "Nonconformity and corrective action — document and retain evidence.", runback_capability: "Golden test + incident-to-test auto-enroll", evidence_type: "audit_log", evidence_link: "/app/golden" },
];

const NIST_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "nist-gov-1", clause: "GOVERN 1", requirement: "Policies, processes, procedures and practices across the organisation related to the mapping, measuring, and managing of AI risks.", runback_capability: "Policy library + org-level policy enforcement", evidence_type: "policy_block", evidence_link: "/app/policies" },
  { id: "nist-map-1", clause: "MAP 1",    requirement: "Context is established and understood — categorise AI tasks by risk level.", runback_capability: "Agent classification + run tagging", evidence_type: "audit_log", evidence_link: "/app/runs" },
  { id: "nist-mea-2", clause: "MEASURE 2",requirement: "AI risk or impact concerns are quantified and monitored.", runback_capability: "Fleet benchmarks + cost attribution + error tracking", evidence_type: "report", evidence_link: "/app/benchmark" },
  { id: "nist-man-4", clause: "MANAGE 4", requirement: "Residual risks, after response actions are in place, are communicated and monitored.", runback_capability: "Compliance report + policy block audit trail", evidence_type: "audit_log", evidence_link: "/app/compliance" },
];

// Section-level citations only — APRA CPS 230 paragraph numbering is not
// independently verified here (unlike the EU AI Act articles above, which are
// well-established). Confirm exact paragraph refs against the current CPS 230
// PDF before this framework is cited in a customer-facing evidence export.
const APRA_CPS230_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "cps230-incident-mgmt",  clause: "Operational risk management — incident identification & escalation", requirement: "Identify, assess, and escalate operational risk incidents with timely internal reporting. CPS 230 is technology-agnostic — it does not name AI specifically — but the same obligation applies wherever an AI agent is part of a material business process.", runback_capability: "Alert rules + immutable run ledger", evidence_type: "ledger", evidence_link: "/app/ledger" },
  { id: "cps230-incident-record",clause: "Operational risk management — incident recording", requirement: "Maintain a complete, tamper-evident record of operational risk incidents sufficient to support APRA notification obligations.", runback_capability: "Signed, hash-chained audit trail", evidence_type: "audit_log", evidence_link: "/app/runs" },
  { id: "cps230-continuity",     clause: "Business continuity — critical operations", requirement: "Maintain the ability to continue critical operations through disruption, with tested continuity arrangements.", runback_capability: "Policy engine fail-open/fail-closed configuration", evidence_type: "policy_block", evidence_link: "/app/policies" },
  { id: "cps230-review",         clause: "Operational risk management — review & reporting", requirement: "Regular review of the operational risk profile and reporting to the board or governing body.", runback_capability: "Compliance report export (machine-readable)", evidence_type: "report", evidence_link: "/app/compliance" },
];

// GDPR — data-protection evidence, distinct from the AI-governance frameworks
// above: minimisation (redaction), storage limitation (retention), and the
// records/security obligations the ledger and audit trail already satisfy.
const GDPR_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "gdpr-art-5-1-c", clause: "Article 5(1)(c)", requirement: "Personal data shall be adequate, relevant, and limited to what is necessary in relation to the purposes for which it is processed (data minimisation).", runback_capability: "In-process PII redaction before anything is sent", evidence_type: "redaction", evidence_link: "/app/compliance" },
  { id: "gdpr-art-5-1-e", clause: "Article 5(1)(e)", requirement: "Personal data shall be kept in a form which permits identification for no longer than is necessary (storage limitation).", runback_capability: "Plan-enforced retention window with automated pruning", evidence_type: "retention", evidence_link: "/app/settings" },
  { id: "gdpr-art-30",    clause: "Article 30",       requirement: "Maintain a record of processing activities under its responsibility.", runback_capability: "Immutable, hash-chained run ledger", evidence_type: "ledger", evidence_link: "/app/ledger" },
  { id: "gdpr-art-32",    clause: "Article 32",       requirement: "Implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk.", runback_capability: "SSO + policy engine + signed audit trail", evidence_type: "audit_log", evidence_link: "/app/runs" },
];

// ISO/IEC 27001:2022 Annex A — information security controls, distinct from
// ISO/IEC 42001's AI-management-system scope above.
const ISO_27001_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "iso27001-a-5-15", clause: "A.5.15", requirement: "Access to information and other associated assets shall be controlled based on business and security requirements.", runback_capability: "SSO (OIDC) + team roles (RBAC)", evidence_type: "sso", evidence_link: "/app/settings/sso" },
  { id: "iso27001-a-8-15", clause: "A.8.15", requirement: "Logs recording activities, exceptions, faults, and other relevant events shall be produced, kept, and regularly reviewed.", runback_capability: "Immutable run ledger + full audit trace", evidence_type: "ledger", evidence_link: "/app/ledger" },
  { id: "iso27001-a-5-34", clause: "A.5.34", requirement: "Privacy and protection of personally identifiable information shall be ensured as required by applicable law.", runback_capability: "In-process PII redaction before capture", evidence_type: "redaction", evidence_link: "/app/compliance" },
  { id: "iso27001-a-5-36", clause: "A.5.36", requirement: "Compliance with information security policies, rules, and standards shall be regularly reviewed.", runback_capability: "Compliance report export (machine-readable)", evidence_type: "report", evidence_link: "/app/compliance" },
];

// Section-level citations only — like APRA CPS 230 above, exact paragraph
// numbering is not independently verified here. Confirm against the current
// CPS 234 PDF before this framework is cited in a customer-facing export.
// Distinct from CPS 230 (operational risk/continuity) — CPS 234 is
// specifically information security.
const APRA_CPS234_CONTROLS: Omit<RegulatoryControl, "status" | "evidence_count">[] = [
  { id: "cps234-capability",   clause: "Information security capability", requirement: "Maintain information security capability commensurate with the size and extent of threats to information assets.", runback_capability: "Policy engine with runtime enforcement", evidence_type: "policy_block", evidence_link: "/app/policies" },
  { id: "cps234-access",       clause: "Access control", requirement: "Implement access controls to information assets, including for third parties, commensurate with the criticality of the asset.", runback_capability: "SSO (OIDC) + team roles (RBAC)", evidence_type: "sso", evidence_link: "/app/settings/sso" },
  { id: "cps234-incident",     clause: "Incident management", requirement: "Have robust mechanisms to detect and respond to information security incidents in a timely manner.", runback_capability: "Alert rules + immutable, tamper-evident ledger", evidence_type: "ledger", evidence_link: "/app/ledger" },
  { id: "cps234-testing",      clause: "Testing program", requirement: "Test information security controls through a systematic testing program.", runback_capability: "Golden test suite + Upgrade gate", evidence_type: "audit_log", evidence_link: "/app/golden" },
];

export const FRAMEWORK_DEFS: Record<FrameworkId, {
  name: string;
  version: string;
  controls: Omit<RegulatoryControl, "status" | "evidence_count">[];
  /** Real regulatory scope — which industries this framework actually governs. Empty = broadly applicable, no vertical tilt. */
  relevantVerticals: Vertical[];
}> = {
  // Annex III high-risk categories explicitly include credit scoring/creditworthiness,
  // medical devices, and justice/law-enforcement decision systems.
  eu_ai_act:   { name: "EU AI Act",      version: "2024/1689",   controls: EU_AI_ACT_CONTROLS, relevantVerticals: ["fintech", "healthcare", "legal"] },
  iso_42001:   { name: "ISO/IEC 42001",  version: "2023",        controls: ISO_42001_CONTROLS, relevantVerticals: [] },
  nist_ai_rmf: { name: "NIST AI RMF",    version: "1.0 (2023)",  controls: NIST_CONTROLS, relevantVerticals: [] },
  // APRA regulates Australian banking, insurance, and superannuation entities specifically.
  apra_cps230: { name: "APRA CPS 230",   version: "2024 (effective 1 Jul 2025)", controls: APRA_CPS230_CONTROLS, relevantVerticals: ["fintech"] },
  gdpr:        { name: "GDPR",           version: "2016/679",    controls: GDPR_CONTROLS, relevantVerticals: [] },
  iso_27001:   { name: "ISO/IEC 27001",  version: "2022",        controls: ISO_27001_CONTROLS, relevantVerticals: [] },
  apra_cps234: { name: "APRA CPS 234",   version: "2019",        controls: APRA_CPS234_CONTROLS, relevantVerticals: ["fintech"] },
};

export interface PublicFrameworkDef {
  id: FrameworkId;
  name: string;
  version: string;
  controls: Omit<RegulatoryControl, "status" | "evidence_count">[];
}

/** Every framework id except eu_ai_act, which has its own hand-written page at /eu-ai-act. */
export const PUBLIC_REGULATORY_FRAMEWORK_IDS = (Object.keys(FRAMEWORK_DEFS) as FrameworkId[]).filter(
  (id) => id !== "eu_ai_act"
);

/**
 * The static clause map for one framework, with no org-specific evidence —
 * for public pages, which have no org to compute live status against. This is
 * the exact same definition object getRegulatoryOverview() below evaluates
 * per-org, so a public page built from it describes the real in-app mapping,
 * not a separate marketing summary of it.
 */
export function publicFrameworkDef(id: FrameworkId): PublicFrameworkDef | null {
  const def = FRAMEWORK_DEFS[id];
  if (!def) return null;
  return { id, name: def.name, version: def.version, controls: def.controls };
}

/** Look up a control's static definition by framework + control id — the hook point for compliance-narrative generation (web/lib/eval/narrative.ts), which needs the requirement text alongside the live evidence. */
export function findControl(frameworkId: FrameworkId, controlId: string): Omit<RegulatoryControl, "status" | "evidence_count"> | null {
  const def = FRAMEWORK_DEFS[frameworkId];
  if (!def) return null;
  return def.controls.find((c) => c.id === controlId) ?? null;
}
