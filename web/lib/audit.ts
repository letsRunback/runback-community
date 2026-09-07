/**
 * Audit export — a complete, tamper-evident record of an agent run that a risk
 * team can hand to an auditor. Roadmap item #1 of the compliance-real story.
 *
 * Integrity model:
 *  - Every event is chained: h_i = SHA-256( h_{i-1} + canonical(event_i) ).
 *    Changing any event breaks its hash and every hash after it.
 *  - content_digest = the final chain hash, signed with either:
 *    a) HMAC-SHA256 (symmetric, AUDIT_SIGNING_KEY) — proves custody, not identity
 *    b) Ed25519 (asymmetric, AUDIT_ED25519_PRIVATE_KEY) — true non-repudiation;
 *       the public key is embedded in the manifest so anyone can verify offline.
 *
 * Generate an Ed25519 key pair (set both env vars):
 *   openssl genpkey -algorithm ed25519 -outform PEM | tee audit_private.pem
 *   openssl pkey -in audit_private.pem -pubout | tee audit_public.pem
 *   AUDIT_ED25519_PRIVATE_KEY="$(cat audit_private.pem)"
 *   AUDIT_ED25519_PUBLIC_KEY="$(cat audit_public.pem)"   # optional — derived at verify time
 *
 * Rotating the Ed25519 key: set AUDIT_ED25519_PRIVATE_KEY (and optionally
 * _PUBLIC_KEY) to the new pair, and move the outgoing values to
 * AUDIT_ED25519_PRIVATE_KEY_PREVIOUS / _PUBLIC_KEY_PREVIOUS. New records sign
 * with the new key only; verifyAuditRecord() still accepts records signed
 * under the previous one. Drop the _PREVIOUS vars once nothing you still care
 * about verifying was signed under the old key.
 */
import { createHash, createHmac, timingSafeEqual, createPublicKey, verify as cryptoVerify } from "crypto";
import { auditHmacKeys } from "@/lib/ledgerCore";
import { getRun, type RunRow } from "@/lib/runs";
import type { TraceEvent } from "@runback/schema";
import { cassetteDigestFromEvents } from "@runback/replay";
import { sign, ourEd25519PublicKeys as ourAuditPublicKeys, type Signature as AuditSignature } from "@/lib/signing";

export const AUDIT_SCHEMA = "runback.audit/v2";

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
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    // Match JSON.stringify: a property whose value is undefined is omitted.
    if (o[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + canonical(o[k]));
  }
  return "{" + parts.join(",") + "}";
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type { AuditSignature };
/** Proof that the recording IS the run's deterministic oracle stream. */
export interface ReplayProof {
  cassette_digest: string;
  entry_count: number;
  algorithm: string;
  note: string;
}
export interface AuditManifest {
  run_id: string;
  generated_at: string;
  event_count: number;
  algorithm: "sha256-chain";
  content_digest: string;
  /** The fused replay proof — what makes this audit re-executable, not just readable. */
  replay: ReplayProof;
  signed: boolean;
  signature: AuditSignature | null;
  verify: string;
  spec_url: string;
  verifier_url: string;
}
export interface AuditRecord {
  $schema: typeof AUDIT_SCHEMA;
  manifest: AuditManifest;
  run: RunRow;
  /** Each event with the chain hash up to and including it. */
  events: (TraceEvent & { _hash: string })[];
}

/** Compute the hash chain over an ordered event list. */
function chain(events: TraceEvent[]): { hashed: (TraceEvent & { _hash: string })[]; digest: string } {
  let prev = "";
  const hashed = events.map((e) => {
    const h = sha256(prev + canonical(e));
    prev = h;
    return { ...e, _hash: h };
  });
  return { hashed, digest: prev || sha256("") };
}

/** Build the audit record for a run, or null if the run doesn't exist.
 *  Pass orgId to scope the lookup to one tenant — required for all authenticated
 *  callers; omit only for public demo runs (null org_id). */
export async function buildAuditRecord(
  runId: string,
  generatedAt: string,
  orgId?: string | null
): Promise<AuditRecord | null> {
  const data = await getRun(runId, orgId ?? undefined);
  if (!data) return null;
  return buildAuditRecordFromEvents(runId, data.run, data.events, generatedAt);
}

/**
 * Build an audit record from an in-memory run + event list, with no DB read.
 *
 * Same chain, same cassette digest, same signature as {@link buildAuditRecord} —
 * this is the shared core, split out so a caller that already holds the events
 * (the public /verify demo record) produces a record that is genuinely valid and
 * verifies through the exact same path a customer's export does. A demo record
 * that could not survive /api/audit/verify would make the page a lie.
 */
export function buildAuditRecordFromEvents(
  runId: string,
  run: RunRow,
  events: TraceEvent[],
  generatedAt: string
): AuditRecord {
  const { hashed, digest } = chain(events);
  const cassette = cassetteDigestFromEvents(events);
  // The signature covers BOTH the event chain and the replay digest.
  const signature = sign(`${digest}:${cassette.digest}`);

  return {
    $schema: AUDIT_SCHEMA,
    manifest: {
      run_id: runId,
      generated_at: generatedAt,
      event_count: events.length,
      algorithm: "sha256-chain",
      content_digest: digest,
      replay: {
        cassette_digest: cassette.digest,
        entry_count: cassette.entry_count,
        algorithm: cassette.algorithm,
        note:
          "The run's oracle stream — every model response and tool output, hash-chained. " +
          "Re-execute the agent against `events` with @runback/replay and the cassette digest must reproduce. " +
          "This is proof the recording IS the deterministic input stream of the run — an audit you can re-run, not just read.",
      },
      signed: !!signature,
      signature,
      verify:
        "Recompute the event chain h_i = SHA-256(h_{i-1} + canonical(event_i)) over `events` → must equal content_digest. " +
        "Recompute the oracle-stream digest from `events` → must equal replay.cassette_digest. " +
        "The signature covers `${content_digest}:${cassette_digest}`. " +
        "Ed25519: verify with the public key embedded in manifest.signature.pubkey (no server key needed — fully offline-verifiable). " +
        "HMAC-SHA256 (legacy): requires AUDIT_SIGNING_KEY. POST this record to /api/audit/verify.",
      spec_url: "https://runback.dev/spec",
      verifier_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://runback.dev"}/verify`,
    },
    run,
    events: hashed,
  };
}

export interface VerifyResult {
  /**
   * Integrity holds AND the signer is pinned. This is the only state that
   * supports "the record is exactly what the agent produced".
   */
  valid: boolean;
  /**
   * "invalid"    — a check failed outright.
   * "unverified" — self-consistent, but its origin is unproven. Not a pass.
   * "valid"      — provably from the holder of the pinned key.
   */
  verdict: "valid" | "unverified" | "invalid";
  /** Internally consistent. Necessary but not sufficient — the algorithm is public. */
  integrity: boolean;
  checks: {
    /** Record declares the $schema this verifier actually checks against. */
    schema: boolean;
    /** run_id and the run summary agree with the signed events (not a forged mirror). */
    consistent: boolean;
    chain: boolean;
    digest: boolean;
    /** The recording reproduces the run's deterministic oracle-stream digest. */
    cassette: boolean;
    /**
     * "valid"          — signature checks out AND the signer is this deployment's
     *                    own audit key (or the shared HMAC secret).
     * "valid-unpinned" — Ed25519 signature is cryptographically sound, but it was
     *                    made by some other key. Sound maths, unproven signer.
     */
    signature: "valid" | "valid-unpinned" | "invalid" | "unsigned" | "no-key";
  };
  /** Human-readable reasons the summary diverged from the signed events, if any. */
  consistencyFailures?: string[];
}

/** Re-verify an audit record's integrity, replay proof, and (if possible) signature. */
export function verifyAuditRecord(record: AuditRecord): VerifyResult {
  const bare = (record.events ?? []).map((e) => {
    // strip the embedded hash before re-hashing
    const copy = { ...e } as Record<string, unknown>;
    delete copy._hash;
    return copy as unknown as TraceEvent;
  });
  const { hashed, digest } = chain(bare);
  const cassette = cassetteDigestFromEvents(bare);

  const chainOk = hashed.every((h, i) => h._hash === record.events[i]?._hash);
  const digestOk = digest === record.manifest?.content_digest;
  const cassetteOk = cassette.digest === record.manifest?.replay?.cassette_digest;

  let signature: VerifyResult["checks"]["signature"] = "unsigned";
  const sig = record.manifest?.signature;
  if (sig) {
    const payload = `${record.manifest.content_digest}:${record.manifest.replay?.cassette_digest}`;
    if (sig.alg === "Ed25519") {
      // The public key is embedded in the manifest (sig.pubkey) so a record is
      // self-contained and verifiable offline. But verifying ONLY against the
      // key the record supplied proves nothing about who signed it: anyone can
      // doctor a record, re-sign it with a keypair they generated, swap in their
      // own pubkey, and it would verify perfectly.
      //
      // So we also pin: if this deployment publishes an audit key, the embedded
      // key must match it to earn "valid". A sound signature from an unrecognised
      // key is reported as "valid-unpinned" — which is the honest answer, and the
      // right one for a self-hosted record pasted into the hosted verifier.
      const pubkeyPem = sig.pubkey;
      if (!pubkeyPem) {
        signature = "no-key";
      } else {
        try {
          const pubKey = createPublicKey(pubkeyPem);
          const ok = cryptoVerify(null, Buffer.from(payload, "utf8"), pubKey, Buffer.from(String(sig.value), "hex"));
          if (!ok) {
            signature = "invalid";
          } else {
            const pinned = ourAuditPublicKeys();
            if (pinned.length === 0) {
              signature = "valid-unpinned";
            } else {
              // Compare normalised DER, never raw PEM text — line wrapping and
              // trailing whitespace differ between exporters and must not
              // change the verdict. Checked against every accepted key
              // (current + previous), the same rotation-safety the HMAC path
              // already has below: a record signed last month must not
              // silently downgrade to "unpinned" the moment the key rotates.
              const embedded = createPublicKey(pubkeyPem).export({ type: "spki", format: "der" }) as Buffer;
              const match = pinned.some((p) => {
                const b = createPublicKey(p).export({ type: "spki", format: "der" }) as Buffer;
                return embedded.length === b.length && timingSafeEqual(embedded, b);
              });
              signature = match ? "valid" : "valid-unpinned";
            }
          }
        } catch {
          signature = "invalid";
        }
      }
    } else {
      // HMAC-SHA256 (legacy symmetric).
      //
      // Checked against every accepted key, not just the current one. A customer
      // who downloaded a record last month holds a signature made with whatever
      // key was configured then; recomputing with only the newest would tell
      // them their filed evidence is invalid the moment we rotate.
      const keys = auditHmacKeys();
      if (!keys.length) signature = "no-key";
      else {
        const provided = Buffer.from(String(sig.value ?? ""));
        let match = false;
        for (const key of keys) {
          // Constant-time compare, and no early exit — never branch on
          // signature bytes, nor leak which key matched.
          const expect = Buffer.from(createHmac("sha256", key).update(payload).digest("hex"));
          if (expect.length === provided.length && timingSafeEqual(expect, provided)) match = true;
        }
        signature = match ? "valid" : "invalid";
      }
    }
  }

  // Integrity and provenance are different claims. The chain algorithm is
  // published on /spec and shipped in @runback/verify, so a self-consistent
  // record can be authored from nothing, or edited and re-chained. Only a
  // signature that verifies against a key pinned out of band shows the record
  // came from the agent it names — so `valid` requires exactly that.
  //
  // "valid-unpinned" is excluded on purpose: the signature is sound, but the key
  // it was checked against travelled inside the record, where an attacker who
  // generated their own keypair controls it.
  const schemaOk = record.$schema === AUDIT_SCHEMA;

  // The signed material is the event chain + cassette digest. It does NOT cover
  // manifest.run_id, generated_at or the top-level `run` summary — so those can
  // be rewritten on a genuinely-signed record while every hash verifies, and the
  // verdict would read VALID beside a forged run_id and a forged outcome. The
  // events carry the truth and ARE signed, so bind the summary to them: a record
  // that misrepresents its own outcome is not valid however intact its chain.
  const consistency = checkAuditConsistency(record);

  const integrity = chainOk && digestOk && cassetteOk && schemaOk && consistency.ok;
  const valid = integrity && signature === "valid";
  const verdict: VerifyResult["verdict"] =
    !integrity || signature === "invalid" ? "invalid" : valid ? "valid" : "unverified";

  return {
    valid,
    verdict,
    integrity,
    checks: { schema: schemaOk, consistent: consistency.ok, chain: chainOk, digest: digestOk, cassette: cassetteOk, signature },
    consistencyFailures: consistency.reasons,
  };
}

/** Deep JSON equality, key-order independent. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === (b as unknown[]).length && a.every((x, i) => jsonEqual(x, (b as unknown[])[i]));
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length &&
    ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) &&
      jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The convenience fields must agree with the signed events. See verify() above. */
function checkAuditConsistency(record: AuditRecord): { ok: boolean; reasons: string[] } {
  const events = (record.events ?? []) as unknown as Record<string, unknown>[];
  const reasons: string[] = [];

  const runIds = new Set(events.map((e) => (e as { run_id?: string }).run_id).filter(Boolean));
  const manifestRunId = record.manifest?.run_id;
  if (manifestRunId && runIds.size && !runIds.has(manifestRunId)) {
    reasons.push(`manifest.run_id (${manifestRunId}) is not the run_id in the signed events`);
  }

  const end = events.find(
    (e) => (e as { type?: string }).type === "run" && (e as { phase?: string }).phase === "end"
  ) as { status?: unknown; output?: unknown; error?: unknown } | undefined;
  const run = record.run as { status?: unknown; output?: unknown; error?: unknown } | undefined;
  if (run && end) {
    if (run.status !== undefined && run.status !== end.status) {
      reasons.push(`run.status contradicts the sealed run-end event`);
    }
    if (run.output !== undefined && !jsonEqual(run.output, end.output ?? null)) {
      reasons.push(`run.output does not match the sealed run-end event`);
    }
    if (run.error !== undefined && !jsonEqual(run.error, end.error ?? null)) {
      reasons.push(`run.error does not match the sealed run-end event`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
