#!/usr/bin/env node
/**
 * runback-verify <cassette.json> [--key <signing-key>]
 *
 * Verify a runback.cassette/v1 audit record from a JSON file.
 * Exit code 0 = valid, 1 = invalid or error.
 *
 * Spec:    https://runback.dev/spec
 * Verify:  https://runback.dev/verify
 */

import { readFileSync } from "node:fs";
import { verifyJson, verifyNarrativeJson, verifyFindingJson } from "./index.js";

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(`
  runback-verify <cassette.json> [--key <signing-key>]

  Verify the integrity of a runback.cassette/v1 audit record.

    <cassette.json>   Path to the cassette JSON file (or - / --stdin for stdin)
    --key <key>       HMAC signing key, for legacy HMAC-signed records only.
                      Ed25519-signed records need no key — they carry their
                      own public key and verify fully offline.
    --json            Print the raw result object instead of the report.

  AI narrative rows (GET /api/runs/:run_id/narrative) and external
  security-finding rows (GET /api/runs/:run_id/security-findings) are
  auto-detected from their shape and verified as chain + payload + signature:

    --current-digest <digest>   Narratives only. The run's current cassette
                                digest (from its own audit export) — confirms
                                the narrative hasn't been left describing a
                                since-altered version of the run.

  Exit codes:
    0  VALID       — integrity holds and the signer is Runback's published key
    2  UNVERIFIED  — record is self-consistent, but its origin is unproven
                     (unsigned, or signed by a key that cannot be pinned)
    1  INVALID     — a check failed, or an error occurred

  A record can be perfectly self-consistent and still be something a stranger
  wrote: the chain algorithm is published. Exit 2 exists so CI can tell the
  difference instead of treating "nobody vouched for this" as a pass.

  Spec:   https://runback.dev/spec
  Online: https://runback.dev/verify
`);
  process.exit(0);
}

const filePath = args[0];
const keyIdx = args.indexOf("--key");
const signingKey = keyIdx !== -1 ? args[keyIdx + 1] : undefined;
const asJson = args.includes("--json");
const digestIdx = args.indexOf("--current-digest");
const currentDigest = digestIdx !== -1 ? args[digestIdx + 1] : undefined;

let json;
try {
  json = filePath === "-" || filePath === "--stdin"
    ? readFileSync(0, "utf-8")
    : readFileSync(filePath, "utf-8");
} catch (err) {
  console.error(`Error reading file: ${err.message}`);
  process.exit(1);
}

const icon = (ok) => ok ? "✓" : "✗";
const sigIcon = (s) =>
  s === "valid" ? "✓"
  : s === "valid-unpinned" ? "~"
  : s === "unsigned" ? "–"
  : s === "no-key" ? "?"
  : "✗";

/** Say plainly what the signature check did and did not establish. Shared by
 *  both audit records and narrative rows — both are signed by the exact same
 *  web/lib/signing.ts primitives, so the same language about pinning/
 *  self-hosted keys/HMAC symmetry applies to either artifact unchanged. */
function signatureNote(checks) {
  switch (checks.signature) {
    case "valid":
      // Both algorithms reach "valid" — Ed25519 pinned to the published key, and
      // HMAC matched against a key the caller passed with --key. Hard-coding
      // Ed25519 here told a self-hoster verifying their OWN hmac-signed record
      // that Runback's published key had vouched for it, which is exactly the
      // kind of overclaim the pinning work existed to remove.
      return checks.signature_alg === "HMAC-SHA256"
        ? "HMAC-SHA256 — matches the signing key you supplied"
        : "Ed25519 — verified against Runback's published key";
    case "valid-unpinned":
      return "Ed25519 — signature is sound, but the signer is not Runback's published key (self-hosted deployments sign with their own)";
    case "unsigned":
      return "record not signed";
    case "no-key":
      return checks.signature_alg === "HMAC-SHA256"
        ? "HMAC-SHA256 — symmetric, so it can only be checked with the signing secret (pass --key)"
        : "no public key embedded in the record";
    case "revoked":
      return `${checks.signature_alg ?? "signature"} — signed by a KEY RUNBACK HAS REVOKED; sound math, untrustworthy signer`;
    case "invalid":
      return `${checks.signature_alg ?? "signature"} — DOES NOT MATCH`;
    default:
      return "";
  }
}

// Auto-detect an AI narrative row (web/lib/narrativesCore.ts), an external
// security-finding row (web/lib/securityFindingsCore.ts), or a full audit
// record: all three are distinguishable by shape — a narrative/finding has
// payload_hash/entry_hash at the top level and no manifest/events (a shape
// an audit record never has), and a finding is the only one of the two with
// a top-level "vendor" field (a narrative's closest analog is "subject",
// never "vendor") — so none of the three can misclassify another.
let parsed;
try { parsed = JSON.parse(json); } catch (err) {
  console.error(`Error: Invalid JSON — ${err.message}`);
  process.exit(1);
}
const isSealedRow = "payload_hash" in parsed && "entry_hash" in parsed && !("manifest" in parsed);
const isFinding = isSealedRow && "vendor" in parsed;
const isNarrative = isSealedRow && !isFinding;

if (isFinding) {
  let fResult;
  try {
    fResult = verifyFindingJson(json, signingKey);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(fResult, null, 2));
    process.exit(fResult.verdict === "valid" ? 0 : fResult.verdict === "invalid" ? 1 : 2);
  }
  const FIND_VERDICT = {
    valid: "\x1b[32mVALID\x1b[0m",
    unverified: "\x1b[33mUNVERIFIED\x1b[0m",
    invalid: "\x1b[31mINVALID\x1b[0m",
  };
  console.log(`\nrunback security finding (${parsed.vendor}) — ${FIND_VERDICT[fResult.verdict]}`);
  if (parsed.run_id) console.log(`  run_id     ${parsed.run_id}`);
  console.log(`  rule       ${parsed.rule}`);
  console.log(`  severity   ${parsed.severity}   verdict   ${parsed.verdict}`);
  console.log();
  console.log(`  ${fResult.checks.payload ? "✓" : "✗"}  payload    — payload_hash matches the stored vendor/rule/severity/verdict/raw_finding`);
  console.log(`  ${fResult.checks.chain ? "✓" : "✗"}  chain      — entry_hash correctly links to the previous finding`);
  console.log(`  ${sigIcon(fResult.checks.signature)}  signature  — ${signatureNote(fResult.checks)}`);
  console.log();
  if (fResult.verdict === "unverified") {
    console.log("  \x1b[33mChain and payload are intact, but the origin of this finding is unproven.\x1b[0m");
    console.log("  Only a signature verified against a key you obtained independently — or an");
    console.log("  HMAC key passed with --key — shows which deployment actually sealed it.");
    console.log();
  }
  process.exit(fResult.verdict === "valid" ? 0 : fResult.verdict === "invalid" ? 1 : 2);
}

if (isNarrative) {
  let nResult;
  try {
    nResult = verifyNarrativeJson(json, signingKey, currentDigest ? { currentContentDigest: currentDigest } : {});
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(nResult, null, 2));
    process.exit(nResult.verdict === "valid" ? 0 : nResult.verdict === "invalid" ? 1 : 2);
  }
  const NARR_VERDICT = {
    valid: "\x1b[32mVALID\x1b[0m",
    unverified: "\x1b[33mUNVERIFIED\x1b[0m",
    invalid: "\x1b[31mINVALID\x1b[0m",
  };
  console.log(`\nrunback narrative (${parsed.subject}) — ${NARR_VERDICT[nResult.verdict]}`);
  console.log(`  run_id     ${parsed.run_id}`);
  console.log(`  model      ${parsed.model_id}`);
  console.log();
  console.log(`  ${nResult.checks.payload ? "✓" : "✗"}  payload    — payload_hash matches the stored prompt/output/context`);
  console.log(`  ${nResult.checks.chain ? "✓" : "✗"}  chain      — entry_hash correctly links to the previous narrative`);
  console.log(`  ${sigIcon(nResult.checks.signature)}  signature  — ${signatureNote(nResult.checks)}`);
  if (nResult.checks.digest_matches !== null) {
    console.log(`  ${nResult.checks.digest_matches ? "✓" : "✗"}  digest     — content_digest ${nResult.checks.digest_matches ? "matches" : "does NOT match"} the run's current digest`);
  } else {
    console.log(`  ?  digest     — no --current-digest supplied; cannot confirm this still describes the run's LIVE content`);
  }
  console.log();
  if (nResult.verdict === "unverified") {
    console.log("  \x1b[33mChain and payload are intact, but the origin of this narrative is unproven.\x1b[0m");
    console.log("  Only a signature verified against a key you obtained independently — or an");
    console.log("  HMAC key passed with --key — shows which deployment actually generated it.");
    console.log();
  }
  process.exit(nResult.verdict === "valid" ? 0 : nResult.verdict === "invalid" ? 1 : 2);
}

let result;
try {
  result = verifyJson(json, signingKey);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

// Emit the verifier's actual result, unmodified. /verify documented a JSON mode
// that did not exist, listing fields ("merkle_proof", "checkpoint_signature")
// for checks this tool has never performed. Printing the real object means the
// docs can only ever describe what the code returns.
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "valid" ? 0 : result.verdict === "invalid" ? 1 : 2);
}

const VERDICT = {
  valid:      "\x1b[32mVALID\x1b[0m",
  unverified: "\x1b[33mUNVERIFIED\x1b[0m",
  invalid:    "\x1b[31mINVALID\x1b[0m",
};

console.log(`\n${result.meta?.schema ?? "runback record"} — ${VERDICT[result.verdict]}`);
if (result.meta?.run_id)     console.log(`  run_id        ${result.meta.run_id}`);
if (result.meta?.generated_at) console.log(`  generated_at  ${result.meta.generated_at}`);
if (result.meta?.event_count !== undefined) console.log(`  events        ${result.meta.event_count}`);
console.log();
console.log(`  ${icon(result.checks.schema)}  schema    — record declares a $schema this verifier knows`);
console.log(`  ${icon(result.checks.consistent)}  summary   — run_id and outcome match the signed events`);
console.log(`  ${icon(result.checks.chain)}  chain     — event hashes form an unbroken SHA-256 chain`);
console.log(`  ${icon(result.checks.digest)}  digest    — manifest.content_digest matches terminal chain hash`);
console.log(`  ${icon(result.checks.cassette)}  cassette  — oracle-stream digest matches manifest.replay.cassette_digest`);
console.log(`  ${sigIcon(result.checks.signature)}  signature — ${signatureNote(result.checks)}`);
console.log();

// The distinction this paragraph draws is the whole point of the tool. Passing
// the first four checks proves the file is self-consistent — and the algorithm
// that makes it self-consistent is published, so anyone can author a file that
// does. Saying "VALID" on that basis was the tool asserting something it had not
// checked.
// A summary that contradicts the signed events is the sharpest failure to name:
// every hash can verify while run_id and outcome are forged.
if (result.checks && result.checks.consistent === false && result.consistency_failures?.length) {
  console.log("  \x1b[31mThe record's summary contradicts its own signed events:\x1b[0m");
  for (const r of result.consistency_failures) console.log(`    • ${r}`);
  console.log("  The events are the signed truth; the summary an auditor reads is not, so a");
  console.log("  record that misrepresents its own outcome is rejected however intact the chain.");
  console.log();
}

if (result.verdict === "unverified") {
  console.log("  \x1b[33mIntegrity holds, but the origin of this record is unproven.\x1b[0m");
  console.log("  The chain algorithm is public (see /spec), so a self-consistent record");
  console.log("  can be authored by anyone. Only a signature verified against a key you");
  console.log("  obtained independently shows it came from the agent it names.");
  console.log();
}

console.log(`  spec      ${result.meta?.spec_url ?? "https://runback.dev/spec"}`);
console.log();

// 0 = provably genuine · 1 = something failed · 2 = self-consistent, origin unproven.
// CI gates on the exit code, so "unverified" must not share an exit code with
// either of the others.
process.exit(result.verdict === "valid" ? 0 : result.verdict === "invalid" ? 1 : 2);
