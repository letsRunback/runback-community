/**
 * The data behind /procurement, extracted so the same content can also be
 * served machine-readable at GET /api/trust — one source, not a page and an
 * API drifting apart. This is the self-serve half of the Vanta-style trust
 * center pattern: a vendor-assessment tool (or a procurement analyst's own
 * script) can pull this directly instead of a human filling in a spreadsheet
 * from what the page says.
 */
import { euAiActState } from "@/lib/euAiAct";

export interface RegulatoryMappingRow {
  framework: string;
  requirement: string;
  control: string;
  evidence: string;
}

const REGULATORY_RAW: RegulatoryMappingRow[] = [
  {
    framework: "EU AI Act · Art. 12",
    requirement: "__EU_REQUIREMENT__",
    control: "Every decision context, model version, and policy state is cryptographically sealed the moment it happens — a tamper-evident record we call a cassette",
    evidence: "Exportable cassette file per run, verifiable without Runback",
  },
  {
    framework: "EU AI Act · Art. 14",
    requirement: "Human oversight — ability to understand, monitor, and override AI outputs",
    control: "Policy gates block non-compliant calls before execution; sealed record enables post-hoc review",
    evidence: "Policy block events are cassette entries with rule, predicate, and full decision context",
  },
  {
    framework: "APRA CPS 230",
    requirement: "Operational incidents and near misses must be identified, escalated, recorded, and addressed — CPS 230 does not name AI; this applies to any material business process, AI-driven or not",
    control: "Deterministic replay of any agent decision from the exact captured context",
    evidence: "Re-executable run record with the exact inputs the model received",
  },
  {
    framework: "APRA CPS 230",
    requirement: "Critical operations must stay within tolerance during disruption, with a business continuity plan to maintain them",
    control: "Policy gates fail open by default; failed trace sends retry in-process on the next flush",
    evidence: "Fail-open design; Enterprise can configure fail-closed",
  },
  {
    framework: "APRA CPS 234",
    requirement: "Information security commensurate with the degree of risk",
    control: "PII redacted before storage (in-process on first-party SDKs, server-side on OTel); RBAC; self-hosted VPC option",
    evidence: "Redaction log; RBAC audit trail; self-host keeps your data entirely in your perimeter",
  },
  {
    framework: "NIST AI RMF · Govern 1.2",
    requirement: "Organisational accountability for AI risk decisions",
    control: "Every decision attributed to a specific run, model version, and policy state — tamper-evident",
    evidence: "Every decision is cryptographically signed and independently time-stamped by outside authorities — so no one, including Runback, can quietly edit history after the fact. (Ed25519-signed digest per run, HMAC-SHA256 fallback without a keypair; append-only Merkle-chained ledger; two independent RFC 3161 timestamp authorities.)",
  },
  {
    framework: "NIST AI RMF · Measure 2.5",
    requirement: "AI system performance monitoring in production, including drift detection",
    control: "Continuous capture of decisions with policy evaluation; model diff on real production inputs",
    evidence: "Model diff report showing behavioural change before a model upgrade ships",
  },
  {
    framework: "NIST AI RMF · Govern 4.1",
    requirement: "Independent oversight — the org's own risk decisions are subject to external review",
    control: "A time-limited, read-only key scoped to specific runs (or all of them) grants an auditor or regulator the same signed record your own team sees — no platform login, no export handed over blind",
    evidence: "Byte-identical signed audit record, downloadable by the external party directly; every access checked for expiry and revocation, not just at issuance",
  },
];

export interface CaiqItem {
  domain: string;
  q: string;
  a: string;
}

export const CAIQ: CaiqItem[] = [
  { domain: "Hosting", q: "Where does our data live?", a: "Self-host in your own VPC — your data never reaches us. Managed cloud resides in the United States (US). EU or Australian residency requires Enterprise self-hosted." },
  { domain: "Data residency", q: "Can we control the region?", a: "Self-host: you choose the region — your cloud, your perimeter. Managed cloud: US only. Enterprise self-hosted gives you full control of the infrastructure and region." },
  { domain: "Encryption — transit", q: "Is data encrypted in transit?", a: "Yes. Managed cloud uses TLS throughout. Self-host runs behind your own TLS terminator. Session cookies are Secure + httpOnly." },
  { domain: "Encryption — at rest", q: "Is data encrypted at rest?", a: "At-rest encryption relies on your Postgres and disk encryption. Application-level field encryption is on the roadmap — not yet shipped, disclosed on our security page." },
  { domain: "Access control", q: "How is access controlled?", a: "RBAC with four roles — owner, admin, member, viewer — enforced on every privileged route. The last owner cannot be removed." },
  { domain: "Authentication", q: "What sign-in methods are supported?", a: "Passwordless magic link, and enterprise OIDC SSO (Okta, Microsoft Entra ID, Google Workspace, Auth0, Ping)." },
  { domain: "PII handling", q: "How is sensitive data protected?", a: "Keys, emails, card numbers (Luhn-checked), and SSNs are redacted before storage. On the Vercel AI SDK and Python/LangGraph collectors this happens inside your process, before any trace leaves it. Integrations that ship via OpenTelemetry send raw spans to us first and are redacted server-side, before storage or display. Standard and strict tiers, plus custom patterns." },
  { domain: "Audit logging", q: "Is there a tamper-evident audit trail?", a: "Yes — every run is cryptographically sealed and, by default, independently time-stamped by outside authorities we don't control, so tampering is detectable, not just discouraged. Each run is a SHA-256 hash chain with a digest signed by Ed25519 by default — asymmetric, verifiable offline against our published key, giving non-repudiation without trusting our servers. Without a keypair, deployments fall back to HMAC-SHA256, which proves integrity but not non-repudiation, since the verifier must hold the same key. Every checkpoint is also timestamped by two outside RFC 3161 authorities and published to a public, hash-chained append-only feed (GET /api/transparency) — so two divergent honestly-timestamped histories would both be visible, side by side, to anyone who archived it, closing the one gap timestamping alone leaves open. Self-hosted customers holding their own AUDIT_SIGNING_KEY / AUDIT_ED25519_PRIVATE_KEY improve their position further." },
  { domain: "Sub-processors", q: "Who are your sub-processors?", a: "Supabase Inc. (US) — managed Postgres database (stores agent traces, account data, audit logs). Resend Inc. (US) — transactional email delivery (magic-link sign-in and alert notifications). Note: Lemon Squeezy LLC acts as Merchant of Record for paid subscriptions and is an independent data controller for payment data — it is not a sub-processor bound by Runback's DPA. Full list with change-notification commitment in the DPA; countersignable copy at legal@runback.dev." },
  { domain: "Data portability", q: "Can we export our data in a portable format?", a: "Yes. Agent trace cassettes use the open, documented runback.cassette/v1 JSON format, exportable per run any time — no Runback account or software needed to read them after export. Chargeback data exports as CSV; compliance reports as structured JSON. Managed cloud provides a data export window before deletion; self-hosted customers own the Postgres database outright. These support your GDPR Art. 20 data-portability obligations." },
  { domain: "Data deletion", q: "Can we delete our data?", a: "Delete any run at any time. On termination we delete or return your data within 30 days, except where retention is required by law. Self-host: entirely under your control." },
  { domain: "Data use", q: "Do you use our data to train models?", a: "No. We do not train models on your data and do not sell personal data." },
  { domain: "Operational resilience", q: "What happens if Runback is unavailable?", a: "Observation runs async — never in your agent's critical path. Policy gates fail open by default so your agent is never blocked by Runback downtime. A failed trace send is requeued in-process and retried on the next flush — that buffer is in-memory only, not persisted to disk, so events not yet flushed are lost if the process exits first." },
  { domain: "Certifications", q: "What certifications do you hold?", a: "None yet, and none in audit. SOC 2 Type II is planned but not started — the observation window alone runs 3–6 months, so we won't imply it's closer than it is. What exists today: a control-by-control mapping on the security page, against shipped mechanisms, not intentions. We operate GDPR-aligned, with a DPA on request. Self-host keeps your data in your own perimeter, which simplifies your own compliance posture." },
  { domain: "Penetration testing", q: "Do you conduct penetration testing?", a: "Not yet by an independent third party — we won't claim an assessment we can't produce a report for. Security work to date is internal: adversarial testing of the audit verifier and tamper-evidence chain, CI guards against cross-tenant reads and unbounded queries, and the control-by-control review on the security page. An external test is planned alongside SOC 2 Type II; we'll publish the date once engaged. Self-hosted deployments run in your own perimeter — your team's standard assessment process applies, and we'll support it." },
  { domain: "Vulnerability disclosure", q: "How do we report a vulnerability?", a: "Email security@runback.dev. We acknowledge within two business days and credit reporters once a fix ships." },
  { domain: "Staff access", q: "Can Runback employees read our agent traces?", a: "On managed cloud: infrastructure staff have database-level access. On the Vercel AI SDK and Python/LangGraph collectors, PII is redacted inside your application process before anything arrives — card numbers, emails, and SSNs never reach us. On OpenTelemetry-fed integrations, raw spans reach our servers and are redacted before storage — the unredacted payload transits our infrastructure, even though it isn't retained unredacted. Either way, the redacted trace content that remains is readable by anyone with database access. Self-hosted: your data never touches our servers; this question doesn't apply." },
  { domain: "Business continuity", q: "What happens to our audit records if Runback ceases to operate?", a: "Self-hosted customers own the database — records remain in your infrastructure regardless of what happens to Runback. Managed cloud: cassette files use an open, documented format (runback.cassette/v1) with a public schema, and export/verify independently without our software or an account. We provide a data export window before any cessation of service." },
  { domain: "Data erasure", q: "How does GDPR right to erasure apply to your append-only ledger?", a: "The append-only ledger is designed so removing an entry breaks the hash chain — that's the point of tamper-evidence. Our approach: redaction keeps personal data from reaching the cassette. If PII did reach a managed-cloud cassette and a verified erasure request arrives, we delete the run record, breaking the chain at that point — the break is itself the honest record. Self-hosted: you own the database and the erasure decision." },
  { domain: "External auditor access", q: "Can we give an external auditor or regulator access without sharing a login?", a: "Yes. An admin issues a time-limited, read-only key from Settings — scoped to specific runs or to all of them — and hands it directly to the auditor. It downloads the exact same signed audit record your own team would see, byte-identical, not a summary. Revocable at any time; access is checked for expiry and revocation on every read, not only when the key is issued." },
];

/** Fills in the EU AI Act enforcement-date placeholder from live state — same content the page has always rendered. */
export function regulatoryMapping(): RegulatoryMappingRow[] {
  const eu = euAiActState();
  return REGULATORY_RAW.map((r) => ({
    ...r,
    requirement: r.requirement === "__EU_REQUIREMENT__"
      ? `Automatic event logs for high-risk AI systems over their operational lifetime — ${eu.enforced ? "enforceable since 2 August 2026" : "enforceable from 2 August 2026"}`
      : r.requirement,
  }));
}
