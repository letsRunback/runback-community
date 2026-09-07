# @runback/verify

Verify the tamper-evidence and integrity of [`runback.cassette/v1`](https://runback.dev/spec) audit records. No account required. Pure Node.js — zero external dependencies.

Every AI agent decision captured by Runback is sealed in a hash-chained, HMAC-signed cassette. This package lets anyone verify the record independently — without Runback software, without a Runback account.

## Install

```bash
npm install @runback/verify
# or
npx @runback/verify cassette.json
```

## CLI

```bash
# Verify a cassette file
runback-verify cassette.json

# Verify from stdin
cat cassette.json | runback-verify -

# Verify the signature (if the record is signed)
runback-verify cassette.json --key <signing-key>
```

Output:

```
runback.audit/v2 — VALID
  run_id        loan-approval-agent-2026-07-01
  generated_at  2026-07-01T09:14:22.000Z
  events        6

  ✓  schema    — record declares a $schema this verifier knows
  ✓  summary   — run_id and outcome match the signed events
  ✓  chain     — event hashes form an unbroken SHA-256 chain
  ✓  digest    — manifest.content_digest matches terminal chain hash
  ✓  cassette  — oracle-stream digest matches manifest.replay.cassette_digest
  ✓  signature — Ed25519 — verified against Runback's published key

  spec      https://runback.dev/spec
```

### Exit codes

| Code | Verdict | Meaning |
|------|---------|---------|
| `0` | `VALID` | Integrity holds **and** the signer is Runback's published key |
| `2` | `UNVERIFIED` | Self-consistent, but its origin is unproven — unsigned, or signed by a key that cannot be pinned |
| `1` | `INVALID` | A check failed, or an error occurred |

**Gate CI on `0`, not on "not `1`".**

The three integrity checks prove a record is internally consistent. They cannot
prove where it came from: the chain algorithm is [published](https://runback.dev/spec)
and shipped in this package, so anyone can author a file that satisfies it, or
edit a real record and re-chain it. Only the signature ties a record to its
producer, which is why `UNVERIFIED` has its own exit code instead of being
folded into either neighbour.

Add `--json` to get the raw result object instead of the report.

## Library

```js
import { verify, verifyJson } from '@runback/verify';

// From a parsed object
const result = verify(cassette);

// From raw JSON string
const result = verifyJson(jsonString);

// With signing key
const result = verify(cassette, process.env.AUDIT_SIGNING_KEY);

console.log(result.valid);      // true only when integrity AND a pinned signer
console.log(result.verdict);    // "valid" | "unverified" | "invalid"
console.log(result.integrity);  // internally consistent — necessary, not sufficient

console.log(result.checks.schema);    // true / false
console.log(result.checks.chain);     // true / false
console.log(result.checks.digest);    // true / false
console.log(result.checks.cassette);  // true / false
console.log(result.checks.signature); // "valid" | "valid-unpinned" | "invalid" | "unsigned" | "no-key"
```

Verifying a self-hosted record signed with your own key? Pass it as
`expectedPublicKey` so it can reach `valid` rather than `valid-unpinned`:

```js
const result = verify(cassette, undefined, { expectedPublicKey: mySpkiPem });
```

## Upgrading from 1.x

**`valid` is stricter, and there is a new exit code.** In 1.x, `valid` was
`chain && digest && cassette && signature !== "invalid"`, so an unsigned record
— or one signed by a key that could not be pinned — returned `true` and exit
`0`. A record fabricated from nothing passed.

In 2.x, `valid` additionally requires `signature === "valid"`. Records that are
intact but unattributed now report `UNVERIFIED` and exit `2`.

If your pipeline checks `exit != 1` or reads `result.valid` on unsigned
records, it will change behaviour — that is the point. To keep the old, weaker
meaning explicitly, check `result.integrity` instead.

## 2.1

Adds the **summary** check. The signature covers the event chain and cassette
digest, not `manifest.run_id`, `generated_at`, or the top-level `run` summary —
so a genuinely-signed record could previously have its run id and outcome
rewritten while every hash still verified. The events carry the truth and are
signed, so 2.1 rejects a record whose summary contradicts them. A genuine
record's summary already agrees with its events, so nothing legitimate changes.
Also fixes a `__proto__`-key handling gap that diverged from a reference JCS
implementation.

## What it verifies

Three required checks, one optional:

| Check | What it proves |
|-------|---------------|
| **summary** | `manifest.run_id` and the top-level `run` summary (status, output, error) match the signed events. The signature covers the event chain, not these convenience fields — so without this check a genuinely-signed record could display a forged outcome. |
| **chain** | Every `event._hash` matches `SHA-256(h_{i-1} + canonical(event))`. Tampering with any event breaks the chain at that point and every hash after it. |
| **digest** | `manifest.content_digest` equals the terminal chain hash — a single value covering all events. |
| **cassette** | `manifest.replay.cassette_digest` equals the oracle-stream digest — proving the recording IS the deterministic input stream of the agent run, not a post-hoc reconstruction. |
| **signature** | `HMAC-SHA256(key, content_digest:cassette_digest)` — optional. Proves the record came from a holder of the signing key. |

## Algorithm

```
# Event chain
h_0 = ""
h_i = SHA-256( h_{i-1} + canonical( event_i_without_hash ) )
canonical = JSON.stringify with all keys sorted recursively

# Oracle stream (cassette digest)
For each event sorted by seq:
  if type === "llm":  entry = { kind: "llm",  key: SHA-256("llm:{model_id}:{canonical(request)}"),  output: response }
  if type === "tool": entry = { kind: "tool", key: SHA-256("tool:{tool_name}:{canonical(input)}"), output: output }
  if type === "env":  entry = { kind: e.kind, key: e.key, output: e.output }
  else: skip
  chain_hash = SHA-256( prev_hash + canonical(entry) )
```

Full specification: [runback.dev/spec](https://runback.dev/spec)

## Online verifier

Paste a cassette at [runback.dev/verify](https://runback.dev/verify) — runs entirely in your browser, the cassette never leaves your machine.

## License

MIT
