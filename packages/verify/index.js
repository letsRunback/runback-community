/**
 * @runback/verify
 *
 * Verify the tamper-evidence and integrity of a runback.cassette/v1 audit record.
 * No Runback account required. Pure Node.js crypto — no external dependencies.
 *
 * Spec: https://runback.dev/spec
 * Online verifier: https://runback.dev/verify
 */

import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";

/**
 * Runback's production Ed25519 audit-signing public key, in SPKI PEM form.
 *
 * Why this is compiled in rather than read from the record
 * -------------------------------------------------------
 * Signed records embed their own `manifest.signature.pubkey` so that the record
 * is self-contained. But verifying a signature against a key the record itself
 * supplied proves only that the file is internally consistent — anyone can
 * re-sign a doctored record with their own keypair and it would "verify".
 *
 * So when the embedded key matches this one, the result is `valid`: the record
 * provably came from Runback. When it does not, the signature may still be
 * cryptographically well-formed, and we report `valid-unpinned` — honest about
 * what was and was not established. Self-hosted deployments sign with their own
 * key and legitimately land in that second case.
 *
 * The current key is served at https://runback.dev/.well-known/runback-audit-key.pem
 * so it can be checked out-of-band.
 *
 * Rotation: a record verifies as `valid` against ANY key in this list, newest
 * first, not just the first one. Without that, shipping a new npm version
 * with a rotated key would silently downgrade every record signed under the
 * outgoing key from "valid" to "valid-unpinned" for anyone who updates —
 * the record didn't change, only our ability to recognise its signer did.
 * When a key rotates, prepend the new key here and keep the old one until no
 * record anyone still verifies was signed under it.
 */
export const RUNBACK_AUDIT_PUBKEYS_PEM = [
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEArDPmR+Gvu1HawnSvM6xjZao7BVPPQ80Qq3sa1hAYvDU=\n-----END PUBLIC KEY-----\n",
];

/** The current signing key — RUNBACK_AUDIT_PUBKEYS_PEM[0]. Kept as a named export for existing callers. */
export const RUNBACK_AUDIT_PUBKEY_PEM = RUNBACK_AUDIT_PUBKEYS_PEM[0];

/**
 * Keys known to have been compromised. A record signed under one of these
 * reports `signature: "revoked"` — a hard fail distinct from
 * "valid-unpinned" — even when the signature itself is cryptographically
 * sound, since a compromised key's signature proves nothing about who
 * actually produced the record. Empty today: no Runback audit key has ever
 * been revoked. The mechanism exists so that if one is, every installed copy
 * of this package (not just the ones updated after the incident) has
 * somewhere to record it.
 */
export const RUNBACK_AUDIT_REVOKED_PUBKEYS_PEM = [];

/**
 * Schemas this verifier knows how to check.
 *
 * `runback.audit/v2` is what web/lib/audit.ts emits today; `runback.cassette/v1`
 * is the spec name kept for records written before the rename. Anything else is
 * rejected rather than checked against rules it never claimed to follow.
 */
export const KNOWN_SCHEMAS = new Set(["runback.audit/v2", "runback.cassette/v1"]);

// ── Canonical serialisation ───────────────────────────────────────────────────

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialisation.
 *
 * Serialises directly from the sorted key list instead of rebuilding an object.
 * That is not a style choice — it is the fix for a real divergence.
 * `Object.keys(v).sort()` orders correctly, but assigning those keys into a
 * fresh `{}` re-applies JavaScript's own property order, which puts
 * integer-like keys ("0", "1", "42") FIRST regardless of the sort. So a record
 * containing such a key canonicalised differently here than under any standard
 * JCS library, and an auditor verifying our record with their own tooling would
 * compute a different digest and conclude the record had been tampered with.
 *
 * Everything else already matched RFC 8785 — number formatting, minimal string
 * escaping and UTF-16 key ordering all come from ECMAScript, which is what the
 * spec is defined against. Only the object rebuild broke it.
 */
function canonical(v, skipTopKey) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map((x) => canonical(x)).join(",") + "]";
  const o = v;
  const parts = [];
  for (const k of Object.keys(o).sort()) {
    // skipTopKey lets the caller drop one key (e.g. "_hash") WITHOUT copying the
    // object first. That copy used to be `Object.assign({}, e)`, whose internal
    // [[Set]] invokes the __proto__ setter and silently DROPS a literal own
    // "__proto__" key — so the verifier hashed a different object than the signer
    // (which canonicalises the raw event), and a reference JCS verifier hashing
    // the __proto__ key would call TAMPERED on a record this package called VALID.
    // Serialising in place, __proto__ included, makes all three agree.
    if (k === skipTopKey) continue;
    if (o[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + canonical(o[k]));
  }
  return "{" + parts.join(",") + "}";
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ── Event chain verification ──────────────────────────────────────────────────

/**
 * Recompute the SHA-256 event chain over the ordered events list.
 *
 * h_0 = ""
 * h_i = SHA-256( h_{i-1} + canonical( event_i_without_hash ) )
 *
 * Returns { hashes, digest } where digest = h_n (terminal chain hash).
 */
/**
 * Recompute the SHA-256 event chain: h_i = SHA-256(h_{i-1} + canonical(event_i)).
 *
 * Exported because /spec tells implementers to produce this format themselves —
 * having the reference implementation importable is the difference between a
 * spec you can read and one you can check yourself against.
 *
 * @param {object[]} events - Events with `_hash` already stripped
 * @returns {{hashes: string[], digest: string}}
 */
export function computeEventChain(events) {
  let prev = "";
  const hashes = events.map((e) => {
    // Skip _hash in place rather than copying — the copy dropped own __proto__
    // keys and diverged from the signer. See canonical()'s skipTopKey note.
    const h = sha256(prev + canonical(e, "_hash"));
    prev = h;
    return h;
  });
  return { hashes, digest: prev || sha256("") };
}

/**
 * Deep structural equality for JSON values, key-order independent.
 * Used to check the record's convenience summary against the signed events.
 */
function jsonEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
}

/**
 * The signed material is the event chain + the cassette digest. It does NOT
 * cover manifest.run_id, manifest.generated_at, or the top-level `run` summary —
 * so those can be rewritten on a genuinely-signed record while every hash still
 * verifies, and the verifier would print VALID beside a forged run_id and a
 * forged outcome. (Demonstrated: a real Runback-signed record with
 * run.status error→completed and a fabricated $5M approval passed exit 0.)
 *
 * The events themselves carry the truth and ARE signed. So bind the convenience
 * fields to them: the manifest's run_id must match the events' run_id, and the
 * `run` summary must match the run-end envelope. A record that misrepresents its
 * own outcome is not valid, however intact its chain — an auditor reads the
 * summary, not the raw stream.
 *
 * Backward compatible: no signature change, no re-signing. A genuine record's
 * summary already agrees with its events, so it still passes.
 */
function checkConsistency(record) {
  const events = Array.isArray(record.events) ? record.events : [];
  const reasons = [];

  const runIds = new Set(events.map((e) => e && e.run_id).filter(Boolean));
  const manifestRunId = record.manifest && record.manifest.run_id;
  if (manifestRunId && runIds.size && !runIds.has(manifestRunId)) {
    reasons.push(`manifest.run_id (${manifestRunId}) is not the run_id in the signed events`);
  }

  const end = events.find((e) => e && e.type === "run" && e.phase === "end");
  const run = record.run;
  if (run && end) {
    if (run.status !== undefined && run.status !== end.status) {
      reasons.push(`run.status (${run.status}) contradicts the sealed run-end event (${end.status})`);
    }
    if (run.output !== undefined && !jsonEqual(run.output, end.output ?? null)) {
      reasons.push("run.output does not match the sealed run-end event");
    }
    if (run.error !== undefined && !jsonEqual(run.error, end.error ?? null)) {
      reasons.push("run.error does not match the sealed run-end event");
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ── Oracle / cassette digest verification ────────────────────────────────────

/**
 * Salience projection — remove volatile fields from an input before keying.
 * Mirrors the `projectInput` function in @runback/replay/src/cassette.ts.
 */
function projectInput(input, projection) {
  const keep = projection?.keep;
  const drop = projection?.drop;
  if ((!keep || keep.length === 0) && (!drop || drop.length === 0)) return input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;

  function dropPath(node, segs) {
    if (node === null || typeof node !== "object" || segs.length === 0) return;
    if (Array.isArray(node)) { node.forEach((el) => dropPath(el, segs)); return; }
    const [head, ...rest] = segs;
    if (rest.length === 0) delete node[head];
    else if (head in node) dropPath(node[head], rest);
  }

  const work = JSON.parse(JSON.stringify(input));
  if (keep && keep.length && !Array.isArray(work)) {
    const keepTop = new Set(keep.map((k) => k.split(".")[0]));
    for (const k of Object.keys(work)) if (!keepTop.has(k)) delete work[k];
  }
  if (drop && drop.length) for (const p of drop) dropPath(work, p.split("."));
  return work;
}

/**
 * Extract the oracle entry from a trace event, or return null if it is not
 * part of the oracle stream (e.g. run-envelope events).
 *
 * Mirrors `oracleEntryOf` in @runback/replay/src/cassette.ts.
 */
function oracleEntryOf(e) {
  if (e.type === "llm") {
    const key = sha256(`llm:${e.model?.model_id ?? ""}:${canonical(projectInput(e.request, e.key_projection))}`);
    const output = e.error ? { error: e.error } : e.response;
    return { kind: "llm", key, output };
  }
  if (e.type === "tool") {
    const key = sha256(`tool:${e.tool_name ?? ""}:${canonical(projectInput(e.input, e.key_projection))}`);
    const output = e.error ? { error: e.error } : e.output;
    return { kind: "tool", key, output };
  }
  if (e.type === "env") {
    return { kind: e.kind, key: e.key, output: e.output };
  }
  return null;
}

/**
 * Recompute the oracle-stream (cassette) digest from the recorded events.
 * The oracle stream is the ordered sequence of every nondeterministic value
 * the agent received — model responses, tool outputs, env reads.
 *
 * chain_step: sha256( prev_hash + canonical({ kind, key, output }) )
 */
/**
 * Recompute the oracle-stream (cassette) digest from a record's events.
 * Exported alongside {@link computeEventChain} as reference implementation.
 *
 * @param {object[]} events - Events with `_hash` already stripped
 * @returns {{digest: string, entry_count: number}}
 */
export function computeCassetteDigest(events) {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  let prev = "";
  let count = 0;
  for (const e of ordered) {
    const entry = oracleEntryOf(e);
    if (!entry) continue;
    prev = sha256(prev + canonical({ kind: entry.kind, key: entry.key, output: entry.output }));
    count++;
  }
  return { digest: prev || sha256(""), entry_count: count };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} VerifyResult
 * @property {boolean} valid - integrity holds AND the signer is pinned. Only this
 *   supports the claim "the record is exactly what the agent produced".
 * @property {"valid"|"unverified"|"invalid"} verdict - "invalid" means something
 *   failed; "unverified" means the record is self-consistent but its origin is
 *   unproven (unsigned, or signed by a key we cannot pin).
 * @property {boolean} integrity - the record is internally consistent. Necessary
 *   but NOT sufficient: the chain algorithm is public, so anyone can produce a
 *   file that satisfies it.
 * @property {Object} checks
 * @property {boolean} checks.schema - record declares a $schema this verifier knows
 * @property {boolean} checks.chain - every event._hash matches the recomputed chain
 * @property {boolean} checks.digest - manifest.content_digest matches the terminal chain hash
 * @property {boolean} checks.cassette - manifest.replay.cassette_digest matches the oracle-stream digest
 * @property {"valid"|"valid-unpinned"|"revoked"|"invalid"|"unsigned"|"no-key"} checks.signature
 * @property {"Ed25519"|"HMAC-SHA256"|null} checks.signature_alg
 */

/**
 * Verify the integrity of a runback.cassette/v1 audit record.
 *
 * Signature handling depends on the algorithm the record was signed with:
 *
 *   Ed25519 (asymmetric) — verifiable completely offline with no shared secret.
 *     The public key travels in the record. If it matches the pinned Runback key
 *     (or one you pass as `expectedPublicKey`) the result is "valid"; otherwise
 *     "valid-unpinned", meaning the maths checks out but the signer is unproven.
 *
 *   HMAC-SHA256 (symmetric) — can only be checked by someone who already holds
 *     the signing secret, so a third party gets "no-key" unless they were given
 *     it. This is the legacy algorithm; records signed this way are not
 *     independently verifiable, by construction.
 *
 * @param {object} record - A parsed cassette JSON object
 * @param {string} [signingKey] - Optional HMAC signing key, for legacy records.
 * @param {object} [opts]
 * @param {string|string[]|null} [opts.expectedPublicKey] - SPKI PEM (or array
 *   of PEMs) to pin the Ed25519 signer against. `null` pins against nothing
 *   (always "valid-unpinned" for a sound signature). Defaults to Runback's
 *   published production keys (current + any still-accepted rotated-out one).
 * @param {string[]} [opts.revokedPublicKeys] - SPKI PEMs to hard-reject as
 *   "revoked" regardless of `expectedPublicKey`. Defaults to
 *   RUNBACK_AUDIT_REVOKED_PUBKEYS_PEM — override to react to a compromise
 *   before a new package version ships.
 * @returns {VerifyResult}
 */
export function verify(record, signingKey, opts = {}) {
  if (!record?.manifest || !Array.isArray(record.events)) {
    throw new TypeError("Not a runback.cassette record — missing manifest or events array.");
  }

  // Pass the RAW events. computeEventChain skips _hash in place; pre-copying with
  // Object.assign here would drop own __proto__ keys before the chain hash ever
  // saw them — the exact double-strip that let a __proto__-injected event pass.
  const { hashes, digest } = computeEventChain(record.events);
  const cassette = computeCassetteDigest(record.events);

  const chainOk = hashes.every((h, i) => h === record.events[i]?._hash);
  const digestOk = digest === record.manifest?.content_digest;
  const cassetteOk = cassette.digest === record.manifest?.replay?.cassette_digest;

  // A record must say what it claims to be. Without this, a file declaring
  // "$schema": "not-runback/v99" — or nothing at all — was hashed, chained and
  // reported against the runback.cassette/v1 rules it never claimed to follow.
  const schemaOk = KNOWN_SCHEMAS.has(record.$schema);

  let signature = "unsigned";
  let signatureAlg = null;
  const sig = record.manifest?.signature;
  if (sig?.value) {
    // Must match web/lib/audit.ts:142 exactly — the signature covers both the
    // event chain and the replay digest, so a record cannot be re-pointed at a
    // different cassette without breaking it.
    const payload = `${record.manifest.content_digest}:${record.manifest.replay?.cassette_digest}`;

    if (sig.alg === "Ed25519") {
      signatureAlg = "Ed25519";
      // `expectedPublicKey` may be a single PEM (back-compat), an array, `null`
      // (pin against nothing), or omitted (default to Runback's published keys).
      const rawPinned =
        opts.expectedPublicKey !== undefined ? opts.expectedPublicKey : RUNBACK_AUDIT_PUBKEYS_PEM;
      const pinned = rawPinned == null ? [] : Array.isArray(rawPinned) ? rawPinned : [rawPinned];
      const revoked = opts.revokedPublicKeys !== undefined ? opts.revokedPublicKeys : RUNBACK_AUDIT_REVOKED_PUBKEYS_PEM;
      const embedded = sig.pubkey;
      if (!embedded) {
        signature = "no-key";
      } else {
        try {
          const pubKey = createPublicKey(embedded);
          const ok = cryptoVerify(
            null,
            Buffer.from(payload, "utf8"),
            pubKey,
            Buffer.from(String(sig.value), "hex")
          );
          if (!ok) {
            signature = "invalid";
          } else {
            // Compare normalised DER, not raw PEM text: whitespace and line
            // wrapping differ between exporters and must not change the verdict.
            const embeddedDer = createPublicKey(embedded).export({ type: "spki", format: "der" });
            const matchesAny = (list) =>
              list.some((p) => {
                const der = createPublicKey(p).export({ type: "spki", format: "der" });
                return embeddedDer.length === der.length && timingSafeEqual(embeddedDer, der);
              });
            if (matchesAny(revoked)) {
              // A sound signature from a known-compromised key proves nothing
              // about who produced the record — checked before "no key to pin
              // against" so a caller who passes expectedPublicKey: null can't
              // accidentally launder a revoked signer into "valid-unpinned".
              signature = "revoked";
            } else if (pinned.length === 0) {
              // No key to pin against — the signature is sound but we cannot
              // say whose it is.
              signature = "valid-unpinned";
            } else {
              signature = matchesAny(pinned) ? "valid" : "valid-unpinned";
            }
          }
        } catch {
          signature = "invalid";
        }
      }
    } else {
      signatureAlg = "HMAC-SHA256";
      const key = signingKey;
      if (!key) {
        signature = "no-key";
      } else {
        const expected = createHmac("sha256", key).update(payload).digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(String(sig.value));
        signature = a.length === b.length && timingSafeEqual(a, b) ? "valid" : "invalid";
      }
    }
  }

  // Integrity: the record is internally consistent. Provenance: we know WHO
  // produced it. These are different claims and conflating them was a hole.
  //
  // The chain algorithm is published on /spec and shipped in this package, so
  // anyone can author a well-formed record from nothing, or edit a real one and
  // re-chain it. Every integrity check then passes. Provenance is the only thing
  // that distinguishes "this is what the agent produced" from "this is a
  // self-consistent JSON file someone wrote", and only a signature that verifies
  // against a key the caller pinned OUT OF BAND establishes it.
  //
  // So `valid` requires signature === "valid". "valid-unpinned" is deliberately
  // excluded: the maths holds, but the signer is whoever generated the keypair
  // travelling inside the record, which an attacker controls.
  // The convenience fields (run_id, run summary) must agree with the signed
  // events, or a genuinely-signed record could display a forged outcome.
  const consistency = checkConsistency(record);

  const integrity = chainOk && digestOk && cassetteOk && schemaOk && consistency.ok;
  const valid = integrity && signature === "valid";

  // Three outcomes, because two cannot express the difference between "this was
  // altered" and "this may be genuine but nothing here proves it".
  const verdict =
    !integrity || signature === "invalid" ? "invalid" : valid ? "valid" : "unverified";

  return {
    valid,
    verdict,
    integrity,
    checks: {
      schema: schemaOk, chain: chainOk, digest: digestOk, cassette: cassetteOk,
      consistent: consistency.ok, signature, signature_alg: signatureAlg,
    },
    consistency_failures: consistency.reasons,
    meta: {
      schema: record.$schema ?? null,
      // Report the run_id from the SIGNED events, not the unsigned manifest — so
      // the displayed identity is one the signature actually covers.
      run_id: [...new Set(record.events.map((e) => e && e.run_id).filter(Boolean))][0]
        ?? record.manifest?.run_id,
      event_count: record.events.length,
      generated_at: record.manifest?.generated_at,
      spec_url: record.manifest?.spec_url ?? "https://runback.dev/spec",
    },
  };
}

/**
 * Verify a cassette from its raw JSON string.
 *
 * @param {string} json - Raw cassette JSON
 * @param {string} [signingKey]
 * @param {object} [opts] - Forwarded to {@link verify} (e.g. expectedPublicKey).
 * @returns {VerifyResult}
 */
export function verifyJson(json, signingKey, opts = {}) {
  let record;
  try { record = JSON.parse(json); }
  catch { throw new SyntaxError("Invalid JSON — could not parse cassette."); }
  return verify(record, signingKey, opts);
}

// ── AI narrative verification ────────────────────────────────────────────────
//
// An ad_narratives row (web/lib/narrativesCore.ts) is a DIFFERENT signed
// artifact from an audit record above: an LLM-generated explanation of a
// model-diff divergence, chained to the org's other narratives and pinned
// (by value, not by re-derivation) to the run's content_digest AT THE TIME
// the narrative was generated. Deliberately reusing this file's canonical(),
// sha256, and Ed25519/HMAC verification primitives rather than a second
// implementation of the same crypto — see web/lib/signing.ts's header
// comment for why a single-source-of-truth for signing logic matters.
//
// Two things a caller can check, independently:
//   1. Structural/chain integrity — payload_hash and entry_hash correctly
//      derive from the stored fields, and the signature verifies.
//   2. Provenance vs. the LIVE run — pass `currentContentDigest` (fetched
//      separately, e.g. from the run's own audit export) to confirm this
//      narrative still describes the run's CURRENT content, not a
//      since-altered version of it. Omitted, `digest_matches` is `null`
//      rather than a false failure — an exported narrative row alone has
//      no way to fetch the live run.

/**
 * @typedef {Object} NarrativeVerifyResult
 * @property {boolean} valid - chain + payload + signature all verify AND
 *   (digest_matches is not explicitly false).
 * @property {"valid"|"unverified"|"invalid"} verdict
 * @property {Object} checks
 * @property {boolean} checks.payload - payload_hash matches the stored fields
 * @property {boolean} checks.chain - entry_hash correctly derives from prev_hash + payload_hash
 * @property {"valid"|"valid-unpinned"|"revoked"|"invalid"|"no-key"} checks.signature
 * @property {"Ed25519"|"HMAC-SHA256"|null} checks.signature_alg
 * @property {boolean|null} checks.digest_matches - null when currentContentDigest wasn't supplied
 */

/**
 * Verify a narrative row (from GET /api/runs/:run_id/narrative, or any
 * exported copy of one).
 *
 * @param {object} row - A narrative row: {org_id, run_id, subject, subject_ref,
 *   content_digest, model_id, prompt, output, payload_hash, prev_hash,
 *   entry_hash, signature}
 * @param {string} [signingKey] - HMAC key, for HMAC-signed narratives only.
 * @param {object} [opts]
 * @param {string} [opts.currentContentDigest] - the run's CURRENT digest, to
 *   check this narrative still describes the run as it exists now.
 * @param {string|string[]|null} [opts.expectedPublicKey] - same semantics as {@link verify}.
 * @param {string[]} [opts.revokedPublicKeys] - same semantics as {@link verify}.
 * @returns {NarrativeVerifyResult}
 */
export function verifyNarrative(row, signingKey, opts = {}) {
  const required = ["org_id", "run_id", "subject", "content_digest", "model_id", "payload_hash", "prev_hash", "entry_hash", "signature"];
  for (const k of required) {
    if (!(k in row)) throw new TypeError(`Not a runback narrative row — missing "${k}".`);
  }

  const expectedPayloadHash = sha256(
    canonical({
      org_id: row.org_id,
      run_id: row.run_id,
      subject: row.subject,
      subject_ref: row.subject_ref ?? null,
      content_digest: row.content_digest,
      model_id: row.model_id,
      prompt: row.prompt,
      output: row.output,
      prev_hash: row.prev_hash,
    })
  );
  const payloadOk = expectedPayloadHash === row.payload_hash;
  const chainOk = sha256(row.prev_hash + row.payload_hash) === row.entry_hash;

  let signature = "no-key";
  let signatureAlg = null;
  const sig = row.signature;
  if (sig?.alg === "Ed25519") {
    signatureAlg = "Ed25519";
    const rawPinned = opts.expectedPublicKey !== undefined ? opts.expectedPublicKey : RUNBACK_AUDIT_PUBKEYS_PEM;
    const pinned = rawPinned == null ? [] : Array.isArray(rawPinned) ? rawPinned : [rawPinned];
    const revoked = opts.revokedPublicKeys !== undefined ? opts.revokedPublicKeys : RUNBACK_AUDIT_REVOKED_PUBKEYS_PEM;
    const embedded = sig.pubkey;
    if (!embedded) {
      signature = "no-key";
    } else {
      try {
        const pubKey = createPublicKey(embedded);
        const ok = cryptoVerify(null, Buffer.from(row.entry_hash, "utf8"), pubKey, Buffer.from(String(sig.value), "hex"));
        if (!ok) {
          signature = "invalid";
        } else {
          const embeddedDer = createPublicKey(embedded).export({ type: "spki", format: "der" });
          const matchesAny = (list) =>
            list.some((p) => {
              const der = createPublicKey(p).export({ type: "spki", format: "der" });
              return embeddedDer.length === der.length && timingSafeEqual(embeddedDer, der);
            });
          if (matchesAny(revoked)) signature = "revoked";
          else if (pinned.length === 0) signature = "valid-unpinned";
          else signature = matchesAny(pinned) ? "valid" : "valid-unpinned";
        }
      } catch {
        signature = "invalid";
      }
    }
  } else if (sig?.alg === "HMAC-SHA256") {
    signatureAlg = "HMAC-SHA256";
    if (!signingKey) {
      signature = "no-key";
    } else {
      const expected = createHmac("sha256", signingKey).update(row.entry_hash).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(String(sig.value));
      signature = a.length === b.length && timingSafeEqual(a, b) ? "valid" : "invalid";
    }
  }

  const digestMatches = opts.currentContentDigest === undefined ? null : opts.currentContentDigest === row.content_digest;
  const integrity = payloadOk && chainOk;
  const valid = integrity && signature === "valid" && digestMatches !== false;
  const verdict = !integrity || signature === "invalid" || digestMatches === false ? "invalid" : valid ? "valid" : "unverified";

  return {
    valid,
    verdict,
    checks: { payload: payloadOk, chain: chainOk, signature, signature_alg: signatureAlg, digest_matches: digestMatches },
  };
}

/**
 * Verify a narrative row from its raw JSON string.
 * @param {string} json
 * @param {string} [signingKey]
 * @param {object} [opts] - Forwarded to {@link verifyNarrative}.
 * @returns {NarrativeVerifyResult}
 */
export function verifyNarrativeJson(json, signingKey, opts = {}) {
  let row;
  try { row = JSON.parse(json); }
  catch { throw new SyntaxError("Invalid JSON — could not parse narrative row."); }
  return verifyNarrative(row, signingKey, opts);
}

// ── External security-finding verification ───────────────────────────────────
//
// An ad_security_findings row (web/lib/securityFindingsCore.ts) is a THIRD
// signed artifact, distinct from both an audit record and a narrative: raw
// third-party evidence (a guardrail vendor's finding — Lakera, Cisco AI
// Defense, ...) sealed the moment it's ingested, chained to the org's other
// findings. Unlike a narrative, there is no content_digest/current-digest
// check — a finding records what a vendor observed at a point in time, which
// doesn't go stale the way a narrative describing a run's live state can.
// Reuses this file's canonical()/sha256/Ed25519/HMAC primitives — same
// single-source-of-truth reasoning as verifyNarrative above.

/**
 * @typedef {Object} FindingVerifyResult
 * @property {boolean} valid
 * @property {"valid"|"unverified"|"invalid"} verdict
 * @property {Object} checks
 * @property {boolean} checks.payload
 * @property {boolean} checks.chain
 * @property {"valid"|"valid-unpinned"|"revoked"|"invalid"|"no-key"} checks.signature
 * @property {"Ed25519"|"HMAC-SHA256"|null} checks.signature_alg
 */

/**
 * Verify a security-finding row (from GET /api/runs/:run_id/security-findings,
 * or any exported copy of one).
 *
 * @param {object} row - {org_id, run_id, span_id, vendor, rule, severity,
 *   verdict, detail, raw_finding, payload_hash, prev_hash, entry_hash, signature}
 * @param {string} [signingKey] - HMAC key, for HMAC-signed findings only.
 * @param {object} [opts]
 * @param {string|string[]|null} [opts.expectedPublicKey] - same semantics as {@link verify}.
 * @param {string[]} [opts.revokedPublicKeys] - same semantics as {@link verify}.
 * @returns {FindingVerifyResult}
 */
export function verifyFinding(row, signingKey, opts = {}) {
  const required = ["org_id", "vendor", "rule", "severity", "verdict", "detail", "payload_hash", "prev_hash", "entry_hash", "signature"];
  for (const k of required) {
    if (!(k in row)) throw new TypeError(`Not a runback security-finding row — missing "${k}".`);
  }

  const expectedPayloadHash = sha256(
    canonical({
      org_id: row.org_id,
      run_id: row.run_id ?? null,
      span_id: row.span_id ?? null,
      vendor: row.vendor,
      rule: row.rule,
      severity: row.severity,
      verdict: row.verdict,
      detail: row.detail,
      raw_finding: row.raw_finding,
      prev_hash: row.prev_hash,
    })
  );
  const payloadOk = expectedPayloadHash === row.payload_hash;
  const chainOk = sha256(row.prev_hash + row.payload_hash) === row.entry_hash;

  let signature = "no-key";
  let signatureAlg = null;
  const sig = row.signature;
  if (sig?.alg === "Ed25519") {
    signatureAlg = "Ed25519";
    const rawPinned = opts.expectedPublicKey !== undefined ? opts.expectedPublicKey : RUNBACK_AUDIT_PUBKEYS_PEM;
    const pinned = rawPinned == null ? [] : Array.isArray(rawPinned) ? rawPinned : [rawPinned];
    const revoked = opts.revokedPublicKeys !== undefined ? opts.revokedPublicKeys : RUNBACK_AUDIT_REVOKED_PUBKEYS_PEM;
    const embedded = sig.pubkey;
    if (!embedded) {
      signature = "no-key";
    } else {
      try {
        const pubKey = createPublicKey(embedded);
        const ok = cryptoVerify(null, Buffer.from(row.entry_hash, "utf8"), pubKey, Buffer.from(String(sig.value), "hex"));
        if (!ok) {
          signature = "invalid";
        } else {
          const embeddedDer = createPublicKey(embedded).export({ type: "spki", format: "der" });
          const matchesAny = (list) =>
            list.some((p) => {
              const der = createPublicKey(p).export({ type: "spki", format: "der" });
              return embeddedDer.length === der.length && timingSafeEqual(embeddedDer, der);
            });
          if (matchesAny(revoked)) signature = "revoked";
          else if (pinned.length === 0) signature = "valid-unpinned";
          else signature = matchesAny(pinned) ? "valid" : "valid-unpinned";
        }
      } catch {
        signature = "invalid";
      }
    }
  } else if (sig?.alg === "HMAC-SHA256") {
    signatureAlg = "HMAC-SHA256";
    if (!signingKey) {
      signature = "no-key";
    } else {
      const expected = createHmac("sha256", signingKey).update(row.entry_hash).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(String(sig.value));
      signature = a.length === b.length && timingSafeEqual(a, b) ? "valid" : "invalid";
    }
  }

  const integrity = payloadOk && chainOk;
  const valid = integrity && signature === "valid";
  const verdict = !integrity || signature === "invalid" ? "invalid" : valid ? "valid" : "unverified";

  return {
    valid,
    verdict,
    checks: { payload: payloadOk, chain: chainOk, signature, signature_alg: signatureAlg },
  };
}

/**
 * Verify a security-finding row from its raw JSON string.
 * @param {string} json
 * @param {string} [signingKey]
 * @param {object} [opts] - Forwarded to {@link verifyFinding}.
 * @returns {FindingVerifyResult}
 */
export function verifyFindingJson(json, signingKey, opts = {}) {
  let row;
  try { row = JSON.parse(json); }
  catch { throw new SyntaxError("Invalid JSON — could not parse security-finding row."); }
  return verifyFinding(row, signingKey, opts);
}
