import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import LedgerVerifier from "@/components/site/LedgerVerifier";
import { demoAuditRecord } from "@/lib/demoAuditRecord";
import { getAdminClient } from "@/lib/supabase/admin";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/verify",
  title: "Verify an audit record — no Runback install needed",
  description:
    "Paste any Runback audit export and verify the hash chain right here — no Runback account, no SDK, no install. The record is cryptographically sealed. Runback cannot alter it after the fact.",
});

interface DeterminismRow {
  tier: string;
  metric: string;
  value: number;
  unit: string | null;
  status: string;
  commit_sha: string;
  created_at: string;
}

/** Latest result per (tier, metric) from the determinism-proof CI gate. */
async function getLatestDeterminismResults(): Promise<DeterminismRow[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { data } = await sb
      .from("ci_determinism_runs")
      .select("tier,metric,value,unit,status,commit_sha,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const latest = new Map<string, DeterminismRow>();
    for (const row of (data ?? []) as DeterminismRow[]) {
      const key = `${row.tier}:${row.metric}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return Array.from(latest.values()).sort(
      (a, b) => a.tier.localeCompare(b.tier) || a.metric.localeCompare(b.metric)
    );
  } catch {
    return [];
  }
}

export default async function Verify() {
  const determinismResults = await getLatestDeterminismResults();
  // See app/docs/page.tsx: /verify survives proxy.ts's self-host gate, so it
  // gets the trimmed self-host nav instead of a footer full of dead links.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  return (
    <>
      <Header selfHosted={selfHosted} />

      {/* ── Hero ── */}
      <section className="mk-section" style={{ paddingTop: "3rem" }}>
        <div className="mk narrate">
          <span className="mk-eyebrow">Open verification</span>
          <h1
            style={{
              fontSize: "clamp(1.9rem,4vw,3rem)",
              letterSpacing: "-0.04em",
              margin: "0.8rem 0 0",
              lineHeight: 1.1,
            }}
          >
            Verify any Runback record.
            <br />
            <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
              Without Runback installed.
            </span>
          </h1>
          <p className="mk-lead" style={{ marginTop: "1rem" }}>
            Every Runback audit export is a hash-chained JSON record. Recompute the
            chain right here — or with{" "}
            <code className="mono" style={{ fontSize: "0.9em" }}>npx @runback/verify</code> —
            no account, no SDK, no dependency on our servers. If the chain verifies,
            the record is internally consistent; if the signature also verifies against
            our published key, it&apos;s exactly what the agent produced. Either check
            failing tells you precisely which one broke.
          </p>
          <p className="mk-lead" style={{ marginTop: "0.6rem" }}>
            Records are signed with <strong>Ed25519</strong> wherever a keypair is
            configured — asymmetric, so a third party can check it offline against our{" "}
            <a href="/.well-known/runback-audit-key.pem" className="appc-link mono" style={{ fontSize: "0.92em" }}>
              published public key
            </a>
            , no secret changes hands. Without a keypair, deployments fall back to{" "}
            <strong>HMAC-SHA256</strong>: the hash chain is still fully checkable by
            anyone, but the signature itself only by whoever holds the key. The
            verifier tells you which one you&apos;re looking at.
          </p>
          <p className="mk-lead" style={{ marginTop: "0.6rem" }}>
            This is what &ldquo;tamper-evident&rdquo; actually means: the proof
            is in the chain, not in trusting the vendor.
          </p>
        </div>
      </section>

      {/* ── The verifier ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">Try it now</span>
          <h2 className="mk-h2">
            Paste an export. Watch the chain verify. No signup.
          </h2>
          <p className="mk-lead" style={{ marginBottom: "1.6rem" }}>
            The demo record below is a real audit export from the
            loan-approval incident walked through in{" "}
            <Link href="/how-it-works#incident" style={{ color: "var(--brand)" }} scroll={false}>
              How it works
            </Link>
            . Prefer your own machine?{" "}
            <a href="/sample-cassette.json" style={{ color: "var(--brand)" }}>
              Download the same record
            </a>{" "}
            and run <code className="mono">npx @runback/verify sample-cassette.json</code>. Click <em>Verify chain</em> and watch each entry&apos;s hash
            check against the one before it, then the signature check establish
            who produced it.
          </p>
          <LedgerVerifier demoRecord={demoAuditRecord()} />
        </div>
      </section>

      {/* ── What this proves ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">What this actually proves</span>
          <h2 className="mk-h2">
            Five things a log can&apos;t give you.
          </h2>
          <div className="cap-grid">
            <div className="cap">
              <div className="cap-k mono">Nothing deleted</div>
              <p>
                The ledger is append-only. Remove any entry and the chain breaks at exactly
                that point. A gap in the sequence is detectable, not concealable. (Enforced
                by <code className="mono" style={{ fontSize: "0.82em" }}>pg_advisory_xact_lock</code>{" "}
                per org.)
              </p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Nothing altered</div>
              <p>
                Change any field in a past entry — decision text, a tool output, a timestamp — and its SHA-256 hash no longer matches what the next entry was sealed against. The failure cascades forward: every downstream hash is invalidated.
              </p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Nothing swapped out</div>
              <p>
                A record can&apos;t be re-pointed at a different replay after the fact
                — the signature covers the decision log and the replay data together,
                as one sealed unit, not two things trusted separately.
                (Signed payload: <code className="mono" style={{ fontSize: "0.82em" }}>content_digest:cassette_digest</code>.)
              </p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Structurally tamper-resistant</div>
              <p>
                The ledger&apos;s tree structure is built so a piece of one entry can never
                be mistaken for a piece of another, even by someone trying to forge it.
                (Domain-separated Merkle tree: leaf nodes prefixed{" "}
                <code className="mono" style={{ fontSize: "0.82em" }}>&quot;leaf:&quot;</code>, internal
                nodes <code className="mono" style={{ fontSize: "0.82em" }}>&quot;node:&quot;</code>, preventing second-preimage attacks.)
              </p>
            </div>
            <div className="cap">
              <div className="cap-k mono">Fail-closed</div>
              <p>
                When a signing key is configured, a missing or invalid signature fails verification — it does not pass. DB write access alone cannot forge a valid checkpoint. The system defaults to rejection, not trust.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── The algorithm ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">For implementers</span>
          <h2 className="mk-h2">
            The exact algorithm, open — the same one in{" "}
            <code className="mono" style={{ fontSize: "0.9em" }}>@runback/verify</code>
          </h2>
          <p className="mk-lead" style={{ marginBottom: "1.2rem" }}>
            You don&apos;t need this to trust the result above — the five guarantees
            already cover it. It&apos;s here for anyone who wants to verify the
            mechanism, audit it, or reimplement it independently. The cassette
            chain and signature below are the field-level detail of{" "}
            <Link href="/spec" className="mk-link">runback.cassette/v1</Link> —
            the open format, not just this algorithm summary.
          </p>
          <pre className="verify-algo" style={{ background: "var(--surface-raised, #0f0f0f)", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "1.4rem 1.6rem", fontFamily: "var(--mono)", fontSize: "0.78rem", lineHeight: 1.7, color: "var(--text-primary)", overflowX: "auto", marginTop: "1.2rem" }}>{`CASSETTE CHAIN
  entry_hash[0] = SHA256("" + canonical({kind, key, output}))
  entry_hash[n] = SHA256(entry_hash[n-1] + canonical({kind, key, output}))
  algorithm: oracle-chain/sha256

EVENT CHAIN  (per run, inside an audit record)
  h[0]          = SHA256("" + canonical(event_0))
  h[n]          = SHA256(h[n-1] + canonical(event_n))
  content_digest = h[last]

AUDIT RECORD SIGNATURE   ← the one an outside auditor checks
  payload       = "{content_digest}:{cassette_digest}"
  Ed25519       = sign(payload, AUDIT_ED25519_PRIVATE_KEY)
                  public key travels in manifest.signature.pubkey AND is
                  published at /.well-known/runback-audit-key.pem — pin against
                  the published copy, or a re-signed forgery verifies too
  HMAC-SHA256   = fallback when no Ed25519 keypair is configured; symmetric,
                  so it is NOT independently verifiable

LEDGER CHAIN  (org-wide, across runs)
  leaf[run]     = SHA256("leaf:" + canonical({run_id, name, status, digest, ended_at, steps}))
  entry[n]      = SHA256(entry[n-1] + leaf[n])
  node(a, b)    = SHA256("node:" + a + b)
  merkle_root   = balanced binary tree over leaves

CHECKPOINT SIGNATURE  (seals the ledger head — distinct from the record above)
  payload       = "ledger:{orgId}:{seq}:{head_hash}:{merkle_root}"
  signature     = HMAC-SHA256(AUDIT_SIGNING_KEY, payload)
  fail-closed   = key configured → signature required to pass verification

NARRATIVE / FINDING CHAIN  (an AI explanation, or an external security-tool
                            finding — sealed the moment it's generated or
                            ingested, chained per-org, NOT part of the
                            cassette/event chain above)
  payload_hash  = SHA256(canonical({...fields, prev_hash}))
  entry_hash    = SHA256(prev_hash + payload_hash)
  signature     = sign(entry_hash)  ← Ed25519 or HMAC-SHA256, same as above
  a narrative also pins content_digest — the evidence it was generated from,
  by value — so a later mismatch proves the evidence changed since sealing`}</pre>
        </div>
      </section>

      {/* ── Determinism CI history ── */}
      {determinismResults.length > 0 && (
        <section className="mk-section">
          <div className="mk">
            <span className="mk-eyebrow">Proven on every push, not just authored</span>
            <h2 className="mk-h2">
              The record/replay substrate&apos;s CI gate — live results.
            </h2>
            <p className="mk-lead" style={{ marginBottom: "1.2rem" }}>
              <code className="mono" style={{ fontSize: "0.9em" }}>determinism-proof</code> runs
              on every push: record a run under the native/ptrace shims, replay it, and assert
              the result is byte-identical. These are the latest results per tier, straight from
              CI — not a one-off log line.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table
                className="mono"
                style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Tier</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Metric</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Value</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Status</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {determinismResults.map((r) => (
                    <tr key={`${r.tier}:${r.metric}`} style={{ borderBottom: "1px solid var(--border-subtle, var(--border))" }}>
                      <td style={{ padding: "0.5rem 0.75rem" }}>{r.tier}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>{r.metric}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        {r.value}
                        {r.unit && r.unit !== "bool" ? ` ${r.unit}` : ""}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", color: r.status === "pass" ? "var(--emerald)" : "var(--rose)" }}>
                        {r.status}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)" }}>
                        {r.commit_sha.slice(0, 7)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── The CLI ── */}
      <section className="mk-section">
        <div className="mk">
          <span className="mk-eyebrow">The open-source CLI</span>
          <h2 className="mk-h2">
            Run it locally. Source is public.
          </h2>
          <p className="mk-lead" style={{ marginBottom: "1.6rem" }}>
            The same verification algorithm ships as a standalone CLI — install
            anywhere, pipe in any export, get a machine-readable verdict. No
            account, no network call. It auto-detects the shape you paste in —
            audit record, sealed AI narrative, or security-tool finding — each
            verified against its own chain and signature.
          </p>
          <div className="verify-cli">
            <div className="vcli-step">
              <span className="vcli-k mono">Install</span>
              <pre className="vcli-code">npm install -g @runback/verify</pre>
            </div>
            <div className="vcli-step">
              <span className="vcli-k mono">Verify a file</span>
              <pre className="vcli-code">runback-verify audit-export.json</pre>
            </div>
            <div className="vcli-step">
              <span className="vcli-k mono">Verify from stdin</span>
              <pre className="vcli-code">cat audit-export.json | runback-verify --stdin</pre>
            </div>
            <div className="vcli-step">
              <span className="vcli-k mono">Machine-readable output</span>
              <pre className="vcli-code">{`runback-verify audit-export.json --json

{
  "valid": true,
  "verdict": "valid",
  "integrity": true,
  "checks": {
    "schema": true,
    "chain": true,
    "digest": true,
    "cassette": true,
    "signature": "valid",
    "signature_alg": "Ed25519"
  }
}`}</pre>
              <p className="empty" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                Exit codes: <code className="mono">0</code> valid ·{" "}
                <code className="mono">2</code> integrity holds but the origin is unproven ·{" "}
                <code className="mono">1</code> a check failed. Gate CI on{" "}
                <code className="mono">0</code>, not on &ldquo;not 1&rdquo;.
              </p>
            </div>
          </div>
          <p className="empty" style={{ marginTop: "1.2rem", fontSize: "0.85rem" }}>
            The verifier is published on npm as{" "}
            <code
              className="mono"
              style={{ fontSize: "0.8rem", color: "var(--text-primary)" }}
            >
              @runback/verify
            </code>{" "}
            — run it with{" "}
            <code
              className="mono"
              style={{ fontSize: "0.8rem", color: "var(--text-primary)" }}
            >
              npx @runback/verify audit.json
            </code>
            . The algorithm is the standard; anyone can implement it.
          </p>
        </div>
      </section>

      {/* ── Why this is the moat ── */}
      <section className="mk-section">
        <div className="mk narrate">
          <span className="mk-eyebrow">Why this matters for governance</span>
          <h2 className="mk-h2">
            A signed record an auditor can check themselves.
          </h2>
          <p className="mk-lead">
            When a regulator or auditor asks for evidence of a past decision,
            &ldquo;trust the vendor&rdquo; isn&apos;t an answer. A Runback export
            is self-verifying: hand over the export and the CLI, and they check
            it themselves — no intermediary required. That&apos;s the difference
            between a log and a proof.
          </p>
          <p className="mk-lead" style={{ marginTop: "0.8rem" }}>
            This is what EU AI Act Art. 12 logging and APRA CPS 230 incident
            management look like in practice — not a screenshot, but a record
            with verifiable integrity.
          </p>
          <div style={{ marginTop: "1.6rem" }}>
            <Link href="/enterprise" className="btn-line">
              See how it maps to your compliance framework →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mk-cta-band">
        <div className="mk">
          <h2>Start capturing records you can verify.</h2>
          <p>
            The free Community edition captures every agent run with a
            signed, verifiable audit record — self-hosted, in your own cloud,
            forever.
          </p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/get-started" className="btn-fill">
              Get the free Community edition →
            </Link>
            <Link href="/contact" className="btn-line">
              Talk to security &amp; risk
            </Link>
          </div>
        </div>
      </section>

      <Footer selfHosted={selfHosted} />
    </>
  );
}
