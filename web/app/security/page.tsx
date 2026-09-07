import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import { tenantIsolationActive } from "@/lib/supabase/tenant";

export const metadata = pageMetadata({
  path: "/security",
  title: "Security & trust",
  description:
    "How Runback protects your agent data: in-process redaction before egress, cryptographically tamper-evident audit records, sealed AI narratives, scoped external-auditor grants, self-host so data never leaves your perimeter, OIDC SSO, and role-based access. Honest about what's shipped vs. on the roadmap.",
});

// Four real control areas these 18 mechanisms fall into — not decorative
// labels, a genuine classification a security reviewer scans by. Colors
// reuse existing semantic tokens (no new palette): data protection =
// emerald, access control = blue, audit & integrity = brand-2 (teal, the
// same "verify/sealed" meaning it already carries site-wide), monitoring
// & governance = violet.
type SecCategory = "data" | "access" | "audit" | "governance";
const CATEGORY: Record<SecCategory, { label: string; color: string }> = {
  data:       { label: "Data protection",       color: "var(--emerald)" },
  access:     { label: "Access control",        color: "var(--blue)" },
  audit:      { label: "Audit & integrity",      color: "var(--brand-2)" },
  governance: { label: "Monitoring & governance", color: "var(--violet)" },
};

/** One small glyph per control category — a scannable visual anchor instead of a bare colored dot, on a page whose 18 detailed entries are otherwise pure text. */
function CategoryIcon({ cat, color }: { cat: SecCategory; color: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" as const, stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (cat) {
    case "data":
      return <svg {...common}><path d="M12 3 L20 6.5 V11.5 C20 16.5 16.5 20 12 21 C7.5 20 4 16.5 4 11.5 V6.5 Z" /></svg>;
    case "access":
      return <svg {...common}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11 V7.5 A4 4 0 0 1 16 7.5 V11" /></svg>;
    case "audit":
      return <svg {...common}><circle cx="8" cy="8" r="3.2" /><circle cx="16" cy="16" r="3.2" /><path d="M10.3 9.8 L13.7 14.2" /></svg>;
    case "governance":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.6" /></svg>;
  }
}

// What's genuinely built today.
const SHIPPED: { k: string; cat: SecCategory; body: string }[] = [
  {
    k: "Redaction before egress",
    cat: "data",
    body:
      "Secrets, API keys, JWTs, emails, card numbers (Luhn-checked), and SSNs are scrubbed inside your own application process — before a trace is sent anywhere. Even your backend never sees them. Two tiers (standard/strict), custom patterns, key allow/deny lists.",
  },
  {
    k: "Runtime policy enforcement",
    cat: "access",
    body:
      "Deterministic policy rules run as an in-process pre-hook: a violating action (e.g. an unescalated $250 refund) is blocked BEFORE it executes — no network in the critical path. Every block is recorded as a hash-chained, re-runnable event: proof the control fired. Rules can be simulated against history before you turn them on. This is application-layer control — it runs inside your process, so prompt injection that gains control of the process can bypass it; infrastructure-layer isolation needs separate defence. An agent simply not calling through Runback is a different concern, covered below (\"Gateway credential isolation\", \"SDK bypass detection\", \"Governance coverage\").",
  },
  {
    k: "Gateway credential isolation",
    cat: "access",
    body:
      "By default, the language-agnostic gateway (@runback/gateway, base-URL swap, no SDK) forwards whatever credential the agent sends — the same key that works calling the gateway also works calling the real provider directly, with nothing to tell you. Setting RUNBACK_GATEWAY_UPSTREAM_KEY and RUNBACK_GATEWAY_TOKEN closes that: the real credential lives only in the gateway process, injected server-side, while agents authenticate with a separate token worthless against the real provider. Pair it with an egress rule blocking direct traffic to your provider except from the gateway. Opt-in and unset by default, so it won't break local dev silently.",
  },
  {
    k: "SDK bypass detection",
    cat: "governance",
    body:
      "The SDK integration (withDebugger) has no separate credential to isolate — it never held one apart from your real provider key, so a call outside the wrapper can't be made to fail the same way. What it can do: notice. installBypassGuard() (or enforceCapture: true) watches for a call to a known model-provider host made outside an instrumented call, and reports it as a governance finding through the same ServiceNow/Jira/PagerDuty pipeline as a coverage gap. \"observe\" mode (default) reports and lets the call through, matching the gate's fail-open default; \"block\" mode throws instead. Opt-in, off by default — it patches globalThis.fetch process-wide.",
  },
  {
    k: "Tamper-evident audit",
    cat: "audit",
    body:
      "Every run exports as a SHA-256 hash chain, with a final content digest signed by Ed25519 by default — asymmetric, verifiable offline against our published key, no shared secret or Runback account required. Change one byte and verification fails. The digest also covers the run's replay oracle, so the record is re-executable, not just readable. Without a keypair configured, deployments fall back to HMAC-SHA256, which proves integrity but not non-repudiation, since the verifier must hold the same key.",
  },
  {
    k: "Append-only ledger",
    cat: "audit",
    body:
      "Org-wide, hash-chained log of every run's digest, with signed checkpoints carrying a Merkle root for inclusion proofs — an auditor can verify any run belongs to the sealed history.",
  },
  {
    k: "Externally witnessed checkpoints",
    cat: "audit",
    body:
      "Our own signature proves nobody else altered the chain — not that we didn't, since we hold the key. So every checkpoint is also time-stamped by two independent RFC 3161 authorities, using certificates we don't control and can't backdate. Rewriting history changes the checkpoint head, and no authority will issue a token for the new head dated earlier. The raw tokens verify with `openssl ts -verify` against the authority's own CA — checking our tamper-evidence needs no Runback software. Time-stamping alone can't catch us keeping two divergent, each honestly-timestamped histories and showing a different one to different parties — so every checkpoint is also published to a public, hash-chained, unauthenticated append-only feed (`GET /api/transparency`): two different heads for the same (log, seq) would both sit in that public record, side by side, for anyone who archived it, and the database rejects writing the second one quietly. We skipped a public blockchain anchor on purpose: it would strengthen this at the cost of an air-gapped install, since anchoring needs a public network self-hosted customers correctly refuse to depend on.",
  },
  {
    k: "Self-host — data never leaves",
    cat: "data",
    body:
      "Runback is a Next.js app and a Postgres database. Run it in your own VPC — traces never touch our servers, and there's no telemetry call-home in the self-hosted core.",
  },
  {
    k: "OIDC single sign-on",
    cat: "access",
    body:
      "Enterprise SSO via OpenID Connect (Authorization Code flow), with issuer, audience and nonce verification against the IdP's JWKS. Works with Okta, Microsoft Entra ID, Google Workspace, Auth0 and Ping. Routed per-org by email domain.",
  },
  {
    k: "Role-based access control",
    cat: "access",
    body:
      "Four roles — owner, admin, member, viewer — enforced on every privileged route. Ownership is protected: only an owner can grant owner, and the last owner can't be removed or demoted.",
  },
  {
    k: "Secrets stored as hashes",
    cat: "data",
    body:
      "API keys and session/magic-link tokens are never stored in the clear — only a non-secret prefix plus a SHA-256 hash. Session cookies are httpOnly, Secure and SameSite=lax with a bounded lifetime.",
  },
  {
    k: "Administrative audit log",
    cat: "audit",
    body:
      "Recorded today: API key issuance/revocation, member invites/removals/role changes, model-provider credential changes, policy changes, prompt version saves and label moves, a human overriding a pairwise verdict or correcting a judge's calibration, legal holds placed/released, ledger checkpoint seals, evidence-package exports, and org settings changes. Each is written to a hash-chained log using the same primitive as the run ledger — deleting an entry breaks the chain, so the log can't be edited by the people it audits. Actor, source IP, and target are recorded; secrets never are. Not yet covered: SSO configuration and retention-window changes.",
  },
  {
    k: "SCIM 2.0 provisioning",
    cat: "access",
    body:
      "Okta, Entra ID, or any SCIM 2.0 provider provisions and deprovisions members automatically — including the discovery endpoints an IdP probes during setup, PATCH/PUT for profile pushes, and userName lookup resolved in the database regardless of directory size. Deprovisioning removes access immediately rather than flagging a row inactive, so there's no manual offboarding step to forget. The endpoint authenticates with a scoped token that can't ingest runs, read run content, or open a session, and refuses to deprovision the last owner. Groups aren't implemented; ResourceTypes says so rather than letting an IdP discover it mid-sync.",
  },
  {
    k: "Legal hold",
    cat: "audit",
    body:
      "Retention deletion can be suspended for runs under a preservation obligation — litigation, a regulator request, an investigation — org-wide or per agent. Every deletion path consults holds first, and if the holds table can't be read, the sweep is skipped rather than proceeding: the failure favours keeping data. Placing and releasing a hold are both logged.",
  },
  {
    k: "Audit export to your SIEM",
    cat: "governance",
    body:
      "Administrative audit events forward to Splunk, Microsoft Sentinel, or any HTTPS collector hourly, so access evidence lands in your SOC, not just our dashboard. Delivery is at-least-once from a per-sink watermark, and every event carries its chain hashes so you can verify the feed wasn't altered in transit.",
  },
  {
    k: "Governance coverage",
    cat: "governance",
    body:
      "Declare the agents you expect to be governed and Runback reconciles that inventory against what actually reports: declared but never instrumented, reporting then gone silent, or observed while absent from your register. Findings open a deduplicated ticket in ServiceNow, Jira, or PagerDuty.",
  },
  {
    k: "Encrypted secrets at rest",
    cat: "data",
    body:
      "OIDC client secrets, customer model-provider keys, SIEM tokens, and workflow credentials are each AES-256-GCM encrypted under their own key, so rotating one never invalidates the others. Plaintext is never stored or returned by an API — only whether a secret is set, and its last four characters where that helps.",
  },
  {
    k: "Tenant isolation",
    cat: "data",
    body:
      "Every workspace is an isolated org. Run data carries a composite (org_id, run_id) identity enforced by the database, so a cross-tenant reference is rejected by Postgres, not a check someone might forget. Queries are org-scoped, and a source-level test fails any that aren't. Self-hosting gives each customer a dedicated database outright.",
  },
  {
    k: "Sealed AI narratives",
    cat: "audit",
    body:
      "A root-cause explanation or a control's evidence summary can be AI-generated on demand — then sealed the same way a run is: hash-chained to your org's prior narratives and signed, with the evidence it was generated from pinned by digest. If that evidence changes afterward, re-verification catches it. The explanation is disposable; the proof it wasn't rewritten is not.",
  },
  {
    k: "External security-tool findings",
    cat: "governance",
    body:
      "A narrowly-scoped, write-only key lets a guardrail vendor (Lakera, Cisco AI Defense, or similar) post findings about your runs into your own sealed record instead of staying siloed in their dashboard. Each finding is hash-chained and signed on arrival, independently of your own oracle chain, so a vendor's webhook can never retroactively alter a run's replay identity.",
  },
  {
    k: "External auditor & regulator grants",
    cat: "access",
    body:
      "Issue a read-only, time-limited key scoped to specific runs — or all of them — from Settings, and hand it to an auditor instead of a login. It downloads the exact same signed record your team would see: byte-identical, not a summary. Revocable any time; every grant is checked for expiry and revocation on every read.",
  },
];


/**
 * SOC 2 Trust Service Criteria mapped to controls that actually exist today.
 *
 * The point is not to imply certification. It is to give a security reviewer
 * something better than "not yet": the specific mechanism behind each criterion,
 * so the assessment is about evidence rather than a missing logo. Every row here
 * corresponds to shipped behaviour described above — nothing aspirational.
 */
const CONTROL_MAP: { c: string; criterion: string; how: string }[] = [
  { c: "CC6.1", criterion: "Logical access is restricted",
    how: "OIDC SSO with per-org domain mapping, four roles enforced server-side beneath every route gate, and API keys issued against narrow scopes that cannot be used outside their purpose." },
  { c: "CC6.2", criterion: "Access is authorised before being granted",
    how: "Membership is created only by an admin invite or by SCIM from your identity provider; the default role for federated users is set per org." },
  { c: "CC6.3", criterion: "Access is removed when no longer required",
    how: "SCIM deprovisioning removes the membership immediately rather than marking it inactive. The last owner of an organisation cannot be removed, so an IdP error cannot strand a workspace." },
  { c: "CC6.6", criterion: "Data in transit is protected",
    how: "HSTS with preload, a strict Content-Security-Policy, and HTTPS enforced at configuration time for every outbound integration — a plain-HTTP collector endpoint is rejected rather than accepted and used." },
  { c: "CC6.7", criterion: "Data at rest is protected",
    how: "Disk-level encryption, plus AES-256-GCM application-level encryption for every stored credential, each under an independently rotatable key. Field-level encryption of run content is a disclosed gap above." },
  { c: "CC7.2", criterion: "Anomalies are detected",
    how: "Server faults are captured, grouped by fingerprint, and pushed as a digest rather than logged unread. Ledger verification re-derives every entry from current data, so alteration is detected, not assumed absent." },
  { c: "CC7.3", criterion: "Incidents are evaluated and acted on",
    how: "Governance findings — a ledger that fails verification, a critical agent gone silent — open a deduplicated ticket in ServiceNow, Jira, or PagerDuty, with an owner and an SLA." },
  { c: "CC4.1", criterion: "Controls are monitored over time",
    how: "The administrative audit log records in-app operator actions — key changes, membership/role changes, policy changes, legal holds, checkpoint seals, evidence exports — in a hash chain the operators can't rewrite, and exports hourly to your SIEM. See the entry above for coverage detail." },
  { c: "C1.1", criterion: "Confidential information is identified and protected",
    how: "On the Vercel AI SDK and Python/LangGraph collectors, redaction runs inside your process before egress, so secrets and PII never reach us. Integrations that ship via OpenTelemetry send raw spans to us first and are redacted server-side before storage or display instead — see the Integrations doc for which paths that applies to. Tenant isolation is enforced by the database through a composite key, not application checks alone." },
  { c: "P4.2", criterion: "Personal information is retained no longer than needed",
    how: "Per-plan retention prunes payloads then summaries on a schedule, with deletions recorded so an audit trail can tell policy from tampering. Legal hold suspends deletion where a preservation obligation applies." },
  { c: "A1.2", criterion: "Availability is monitored",
    how: "A health endpoint reports readiness against the database and answers 503 when it cannot serve, so an external monitor reacts without parsing a response body." },
];

// What we are candid is NOT done yet — disclosing this is the point.
const ROADMAP: { k: string; body: string }[] = [
  { k: "Application-level field encryption at rest", body: "Data at rest is protected by Postgres and disk-level encryption in your VPC. Application-level field encryption (column-level or envelope encryption) is on the roadmap, not yet shipped. For regulated environments that require it, self-hosted deployment in your own KMS-backed VPC is the current path." },
  // NOTE: this entry moves between ROADMAP and the live list at render time,
  // from tenantIsolationActive() — see below. Hand-labelling it would mean the
  // page could claim enforcement the deployment is not actually doing, which is
  // the one thing a security page must never do.
  { k: "Database row-level security", body: "Tenancy is enforced by schema for run data: a run is (org_id, run_id), not run_id alone, and events reference runs through a composite foreign key — the database rejects a cross-tenant reference. RLS is enabled on every table, anon/authenticated roles are revoked, and default privileges close new tables on creation. A dedicated `tenant` database role exists that cannot bypass RLS, with policies reading the tenant from a short-lived signed token rather than the query — so a read through it returns only one org's rows, and a missing filter returns nothing rather than another customer's data. Run reads are migrated first; ledger and compliance paths follow. To be precise: policies are load-bearing only where the tenant role is configured — remaining paths still run as a role that bypasses RLS, and writes are unchanged. Until every path migrates, isolation there rests on application-layer filtering plus CI guards that fail any query filtering on a run id without an org. Full design and rollout state: docs/RLS-PLAN.md." },
  { k: "Session revocation and rotation", body: "Session cookies are valid 30 days with no sliding expiry, no rotation on privilege changes, and no admin-initiated revocation. A future release adds per-session revocation (sign out everywhere), automatic rotation on privilege changes, and last-seen tracking. If you suspect a session is compromised, support@runback.dev can manually delete the session record." },
  { k: "Additional data-residency regions", body: "Managed cloud currently resides in the US; self-host keeps data in your own region. EU and AU managed regions are on the roadmap with no committed date. Enterprise self-hosted is available now, in any region." },
];

const RLS_KEY = "Database row-level security";

/**
 * The RLS entry's status is read from the deployment, not written by hand.
 *
 * A security page that hard-codes "Roadmap" understates a deployment that has
 * finished the rollout; one that hard-codes "Live" overstates every deployment
 * that has not. Both are wrong in the way that matters most on this page, so
 * the status is computed and the body text says which state produced it.
 */
function rlsStatus(): { live: boolean; note: string } {
  const live = tenantIsolationActive();
  return {
    live,
    note: live
      ? "Active on this deployment: reads on the migrated paths run as the `tenant` role, which cannot bypass RLS, with the org taken from a short-lived signed token rather than the query."
      : "Not active on this deployment: the tenant role is not configured, so reads run as a role that bypasses RLS and isolation rests on application-layer filtering plus the CI guards described above.",
  };
}

export default function Security() {
  return (
    <>
      <Header />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="mk" style={{ position: "relative", zIndex: 1, paddingTop: "1rem", paddingBottom: "1rem" }}>
          <span className="mk-eyebrow">Security &amp; trust</span>
          <h1 className="hero-h1" style={{ maxWidth: "20ch" }}>
            Built so your <span className="accent">auditors</span>, not just your engineers, sign off.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "64ch" }}>
            You&apos;re about to trust us with your agents&apos; decisions. Here is
            exactly what protects your data, what&apos;s shipped, and what
            isn&apos;t yet — no marketing asterisks.
          </p>
          <div className="hero-cta">
            <Link href="/demo" className="btn-fill">Book a security review →</Link>
            <Link href="/enterprise" className="btn-line">For risk teams</Link>
          </div>
        </div>
      </section>

      {/* ── Why this over a database log — plain language, not the technical
          control grid below. External feedback: the "cassette" framing
          clicks instantly for a developer who's used VCR-style test
          recording, but a compliance officer or board member meeting the
          term cold has no equivalent to reach for. Nothing on the site
          explained the actual advantage over "we have logs in Postgres" in
          plain terms — the technical explanation (hash chains, RFC 3161
          timestamps) was the ONLY explanation, aimed at readers who already
          accept why that matters. */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Before the technical detail</span>
          <h2 className="mk-h2">Why not just use a database log?</h2>
          <p className="mk-lead mk-lead-wide">
            A traditional log is a row in a database. Anyone with admin access can
            edit or delete it — and the log itself has no way to prove that didn&apos;t
            happen. You&apos;re trusting whoever runs the database.
          </p>
          <p className="mk-lead mk-lead-wide">
            A signed cassette is built differently: every decision is mathematically
            linked to the one recorded before it. Change or delete anything, anywhere
            in that history, and the link breaks — visibly, provably, without
            anyone having to be trusted to notice.
          </p>
          <div className="sec-plain-compare">
            <div className="sec-plain-col" data-tone="rose">
              <div className="sec-plain-hd">A database log</div>
              <ul>
                <li>&quot;Trust us — nobody touched it.&quot;</li>
                <li>An edit changes the row, with no trace of the edit.</li>
                <li>Deleting a row deletes the evidence along with it.</li>
              </ul>
            </div>
            <div className="sec-plain-col" data-tone="emerald">
              <div className="sec-plain-hd">A signed cassette</div>
              <ul>
                <li>&quot;Verify it yourself — you don&apos;t have to trust us.&quot;</li>
                <li>An edit breaks the chain, visibly, the next time anyone checks it.</li>
                <li>Deleting a run breaks the chain at that point — the gap is itself the record.</li>
              </ul>
            </div>
          </div>
          <p className="mk-lead" style={{ fontSize: "0.85rem", marginTop: "0.9rem" }}>
            The verifier itself is MIT-licensed and published as{" "}
            <code className="mono">@runback/verify</code> — install it, read the source, run it
            against your own export with no Runback account or network call involved.{" "}
            <Link href="/verify" className="mk-link">Try it now →</Link>
          </p>
        </div>
      </section>

      {/* ── Shipped ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">What protects your data — today</span>
          <h2 className="mk-h2">Shipped today.</h2>

          {/* Four real control areas, scannable before the eighteen
              paragraphs below — not a substitute for reading the mechanism,
              a map of where to look first. */}
          <div className="sec-legend">
            {(Object.keys(CATEGORY) as SecCategory[]).map((cat) => (
              <div className="sec-legend-item" key={cat}>
                <span className="sec-legend-dot" style={{ background: CATEGORY[cat].color }} />
                <span className="sec-legend-label mono">{CATEGORY[cat].label}</span>
                <span className="sec-legend-count mono">{SHIPPED.filter((s) => s.cat === cat).length}</span>
              </div>
            ))}
          </div>

          <details className="mk-details" style={{ marginTop: "1.2rem" }}>
            <summary className="mk-details-summary">View all {SHIPPED.length} mechanisms in detail →</summary>
            <div className="sec-grid">
              {SHIPPED.map((s) => (
                <div className="sec-cell" key={s.k} style={{ borderTopColor: CATEGORY[s.cat].color }}>
                  <div className="sec-k">
                    <CategoryIcon cat={s.cat} color={CATEGORY[s.cat].color} />
                    {s.k}
                    <span className="sec-badge" data-s="live">Live</span>
                  </div>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
      </section>

      {/* ── Honest roadmap ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">What isn&apos;t done yet</span>
          <h2 className="mk-h2">We&apos;d rather you read it here than find it in the review.</h2>
          <p className="mk-lead" style={{ marginBottom: "0.4rem" }}>
            Disclosing limits is part of being audit-grade. These are known gaps with
            a plan, not surprises.
          </p>
          <div className="sec-grid">
            {ROADMAP.map((s) => {
              // The RLS row carries the deployment's real state rather than a
              // fixed "Roadmap" label, and appends which state produced it.
              const rls = s.k === RLS_KEY ? rlsStatus() : null;
              const live = rls?.live ?? false;
              return (
                <div className="sec-cell" key={s.k}>
                  <div className="sec-k">
                    {s.k}
                    <span className="sec-badge" data-s={live ? "live" : "soon"}>
                      {live ? "Live" : "Roadmap"}
                    </span>
                  </div>
                  <p>{s.body}{rls ? ` ${rls.note}` : ""}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Control map ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Certification status</span>
          <h2 className="mk-h2">Not certified yet. Here is exactly how we are controlled.</h2>
          <p className="mk-lead" style={{ marginBottom: "2rem" }}>
            Runback holds no SOC 2 or ISO 42001 report today, and we are not going to imply otherwise.
            What we can give your reviewer is the mechanism behind each criterion, so the assessment is
            about evidence rather than a missing logo. Every row below is behaviour that ships in the
            product now — the gaps are listed above, in the same detail.
          </p>
          <div className="table-wrap">
            <table className="appc-table">
              <thead>
                <tr><th>Criterion</th><th>Requirement</th><th>How Runback meets it</th></tr>
              </thead>
              <tbody>
                {CONTROL_MAP.map((r) => (
                  <tr key={r.c}>
                    <td className="mono">{r.c}</td>
                    <td>{r.criterion}</td>
                    <td>{r.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── For procurement ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">For procurement &amp; security teams</span>
          <h2 className="mk-h2">The documents your review needs.</h2>
          <p className="mk-lead" style={{ marginBottom: "2rem" }}>
            A short kit so your assessment doesn&apos;t start from a blank page.
          </p>
          <div className="cap-grid">
            <div className="cap">
              <div className="cap-k mono">Security overview &amp; CAIQ-lite</div>
              <p>A one-page architecture &amp; data-handling summary and a pre-filled questionnaire covering access, encryption, data flow and sub-processors. <Link href="/procurement" style={{ color: "var(--brand)" }}>Open the procurement kit →</Link></p>
            </div>
            <div className="cap">
              <div className="cap-k mono">DPA &amp; terms</div>
              <p>A Data Processing Agreement, <Link href="/terms" style={{ color: "var(--brand)" }}>Terms of Service</Link> and <Link href="/privacy" style={{ color: "var(--brand)" }}>Privacy Policy</Link> ready for your legal team. DPA available on request for signature.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Self-host = shortest path</div>
              <p>The fastest security approval is the one where nothing leaves your perimeter. Run Runback in your own VPC and most reviews get short.</p>
            </div>
            <div className="cap">
              <div className="cap-k mono">We join the review</div>
              <p>On Enterprise, we sit in your security review and answer questions directly. <Link href="/contact" style={{ color: "var(--brand)" }}>Start one →</Link></p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Put it in front of your security team.</h2>
          <p>Self-host so nothing leaves your perimeter, or start a review with us — we&apos;ll bring the documents.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/demo" className="btn-fill">Book a security review →</Link>
            <Link href="/procurement" className="btn-line">Open the procurement kit</Link>
          </div>
          <p style={{ marginTop: "1.6rem", fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center" }}>
            Found a vulnerability?{" "}
            <a href="mailto:security@runback.dev" style={{ color: "var(--text-muted)", textDecoration: "underline" }}>security@runback.dev</a>
            {" "}— acknowledged within two business days.
          </p>
        </div>
      </section>

      <Footer />
    </>
  );
}
