import Link from "next/link";
import CodeBlock from "@/components/site/CodeBlock";

function ChainDiagram() {
  const boxes = [
    { x: 20, label: "entry 1", hash: "h₁" },
    { x: 210, label: "entry 2", hash: "h₂" },
    { x: 400, label: "entry 3", hash: "h₃" },
  ];
  return (
    <figure className="blog-figure">
      <svg viewBox="0 0 640 150" role="img" aria-labelledby="chain-diagram-title">
        <title id="chain-diagram-title">Each entry&apos;s hash is computed over the previous entry&apos;s hash plus its own data</title>

        {boxes.map((b, i) => (
          <g key={b.label}>
            <rect x={b.x} y={50} width={130} height={54} rx={8} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
            <text x={b.x + 65} y={72} textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fill="var(--text-primary)">{b.label}</text>
            <text x={b.x + 65} y={90} textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--text-muted)">hash = {b.hash}</text>
            {i > 0 && (
              <path d={`M${b.x - 60} 77 H${b.x - 2}`} stroke="var(--border)" strokeWidth={1.5} markerEnd="url(#ch-arrow)" />
            )}
          </g>
        ))}
        <text x="147" y="42" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">h₂ = SHA256(h₁ + entry2)</text>
        <text x="337" y="42" textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--text-muted)">h₃ = SHA256(h₂ + entry3)</text>

        {/* checkpoint */}
        <path d="M465 50 V25" stroke="var(--emerald)" strokeWidth={1.2} strokeDasharray="3 3" />
        <rect x="400" y="4" width="130" height="24" rx={6} fill="rgba(16,185,129,0.08)" stroke="var(--emerald)" strokeWidth={1.2} />
        <text x="465" y="20" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--emerald)">signed checkpoint</text>

        {/* tamper illustration */}
        <text x="145" y="130" textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fill="var(--rose)">change entry 1 → h₁ changes → h₂, h₃ all break</text>

        <defs>
          <marker id="ch-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <figcaption className="blog-figcaption">
        Each entry&apos;s hash folds in the previous entry&apos;s hash. Alter anything upstream and
        every hash after it stops matching — there&apos;s no way to edit one entry in isolation.
      </figcaption>
    </figure>
  );
}

export default function HashChainedAuditTrail() {
  return (
    <>
      <p className="blog-p">
        An auditor doesn&apos;t ask if your agent made the right call. They ask if you can prove
        what it actually did — and &ldquo;trust the vendor&rdquo; is not evidence. Most agent logs
        are a database table someone with write access could edit an hour before the review. Ours
        is built so that isn&apos;t true, and so you don&apos;t have to take our word for it either.
      </p>

      <div className="mk-stats" style={{ gridTemplateColumns: "1fr", margin: "1.6rem 0 2rem" }}>
        <div className="mk-stat">
          <div className="n" data-tone="rose">1 byte</div>
          <div className="l">changed in any past entry — every hash chained after it breaks, provably</div>
        </div>
      </div>

      <ChainDiagram />

      <h2 className="blog-h2">What this actually proves</h2>
      <p className="blog-p">
        <strong>Nothing deleted.</strong> The ledger is append-only, enforced by an advisory
        transaction lock per organization. Remove any entry and the chain breaks at exactly that
        point — a gap in the sequence is detectable, not concealable.
      </p>
      <p className="blog-p">
        <strong>Nothing altered.</strong> Change any field in any past entry — a decision, a tool
        output, a timestamp — and its hash no longer matches what the next entry was sealed
        against. The failure cascades forward: every downstream hash is invalidated, not just the
        one you touched.
      </p>
      <p className="blog-p">
        <strong>Dual-chain seal.</strong> The checkpoint signature covers both the event-chain
        digest and the cassette digest together — possession of a valid, signed checkpoint means
        the full runtime, including every nondeterministic input the agent touched, is accounted
        for, not just the decision log.
      </p>

      <div className="blog-pullquote">
        Fail-closed, not fail-open. When a signing key is configured, a missing or invalid
        checkpoint signature fails verification — database write access alone can&apos;t forge a
        valid checkpoint.
      </div>

      <h2 className="blog-h2">The algorithm, in full</h2>
      <p className="blog-p">
        No part of this is proprietary magic. This is the exact algorithm — the same one
        implemented in the open-source <code>@runback/verify</code> CLI, so anyone can check our
        work without trusting our servers:
      </p>
      <CodeBlock label="runback.cassette/v1 — algorithm">{`CASSETTE CHAIN
  entry_hash[0] = SHA256("" + canonical({kind, key, output}))
  entry_hash[n] = SHA256(entry_hash[n-1] + canonical({kind, key, output}))
  algorithm: oracle-chain/sha256

LEDGER CHAIN
  leaf[run]     = SHA256("leaf:" + canonical({run_id, name, status, digest, ended_at, steps}))
  entry[n]      = SHA256(entry[n-1] + leaf[n])
  node(a, b)    = SHA256("node:" + a + b)
  merkle_root   = balanced binary tree over leaves

CHECKPOINT SIGNATURE
  payload       = "ledger:{orgId}:{seq}:{head_hash}:{merkle_root}"
  signature     = Ed25519(AUDIT_ED25519_PRIVATE_KEY, payload)   // default — asymmetric, verifiable with no shared secret
                = HMAC-SHA256(AUDIT_SIGNING_KEY, payload)        // fallback — no keypair configured
  fail-closed   = key configured → signature required to pass verification`}</CodeBlock>
      <p className="blog-p">
        <strong>Domain-separated Merkle tree.</strong> Leaf nodes are hashed with a{" "}
        <code>&quot;leaf:&quot;</code> prefix, internal nodes with <code>&quot;node:&quot;</code> —
        so a leaf value can never be confused with a node value at any depth, closing off a class
        of second-preimage attack.
      </p>

      <h2 className="blog-h2">So what?</h2>
      <p className="blog-p">
        This is what EU AI Act Article 12 logging and APRA CPS 230 incident management look like in
        practice — not a screenshot of a dashboard, but a record whose integrity a third party can
        verify independently, without asking your engineering team to vouch for it. When the
        question is &ldquo;how do we know this wasn&apos;t edited,&rdquo; the answer is a chain
        anyone can re-derive, not a promise.
      </p>
      <p className="blog-p">
        Paste a real export and watch the chain verify yourself, no account needed, at{" "}
        <Link href="/verify" className="up-link-blue">runback.dev/verify</Link>.
      </p>
    </>
  );
}
