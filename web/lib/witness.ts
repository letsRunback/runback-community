/**
 * External witnessing for ledger checkpoints (RFC 3161).
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * Until now the ledger was self-attested. Runback signs each checkpoint with
 * AUDIT_SIGNING_KEY, and Runback holds that key — so anyone with database
 * access AND the key could rewrite history, re-seal it, and verification would
 * pass. Every check in the system answers "was this altered by someone else",
 * and none answered "was this altered by the operator".
 *
 * For a product whose entire claim is evidentiary, that is the question an
 * auditor asks first, and "trust us" is not an answer. A free competitor
 * (halo-record) already anchors to external witnesses; we did not.
 *
 * ── Why RFC 3161 rather than a blockchain or our own witness ────────────────
 * A Time-Stamp Authority signs "this hash existed at this time" with a
 * certificate we do not control and cannot backdate. That is exactly — and
 * only — the property missing: it makes retroactive rewriting detectable, because
 * a rewritten chain has a different head, and no TSA will issue a token for the
 * new head dated in the past.
 *
 * It is also verifiable with `openssl ts -verify`, a tool that predates us and
 * that we do not ship. That matters more than it sounds: a customer checking our
 * tamper-evidence should not have to run our verifier to do it.
 *
 * A second witness is requested from an independent TSA where configured, so a
 * single compromised or defunct authority does not silently become a single
 * point of trust.
 *
 * ── What this does NOT prove ───────────────────────────────────────────────
 * A timestamp proves a head existed by a time. It does not prove the head is
 * the *only* history we ever held — we could seal two divergent chains and
 * timestamp both. Detecting that needs a public append-only log where all
 * submissions are visible (Sigstore Rekor, or a published checkpoint feed).
 * That is the next step, and docs/RLS-PLAN.md's sibling note in
 * docs/WITNESSING.md says so rather than implying this is complete.
 */
import crypto from "crypto";

/** Public TSAs. Free, no account, widely used. Order is preference.
 *
 *  http is acceptable HERE, and only here, because we now verify the token binds
 *  to our imprint (extractSignedImprint below). A MITM on a plaintext hop can
 *  therefore only DENY a witness — corrupt the response, which we reject and
 *  skip — never FORGE one, which needs the authority's signing key. The token's
 *  integrity rests on the TSA's signature, not the channel. digicert's public
 *  TSA is http-only; requiring https there just cost us the second witness.
 *
 *  Two independent authorities so a single compromised or defunct one is not a
 *  silent single point of trust. Override with RUNBACK_TSA_URLS (an internal
 *  RFC 3161 authority for an air-gapped deployment). */
const DEFAULT_TSAS = [
  { name: "freetsa.org", url: "https://freetsa.org/tsr" },
  { name: "digicert", url: "http://timestamp.digicert.com" },
];

export interface WitnessReceipt {
  tsa: string;
  /** Base64 DER RFC 3161 TimeStampToken. Opaque here, verifiable by openssl. */
  token: string;
  /** The hash the TSA attested — must equal sha256("checkpoint:"+seq+":"+head+":"+root), all public. */
  imprint: string;
  requestedAt: string;
}

/* ── Minimal DER, enough for a TimeStampReq ────────────────────────────────
 * Hand-rolled rather than pulling in an ASN.1 library. A TimeStampReq is a
 * dozen bytes of structure, and this code sits on the path that issues
 * evidence — a dependency here is a supply-chain surface on the one component
 * whose whole job is to be trustworthy.
 */
const tag = (t: number, body: Buffer): Buffer => {
  // Long-form length for anything over 127 bytes.
  let len: Buffer;
  if (body.length < 0x80) len = Buffer.from([body.length]);
  else {
    const n = Buffer.from(body.length.toString(16).padStart(
      Math.ceil(body.length.toString(16).length / 2) * 2, "0"), "hex");
    len = Buffer.concat([Buffer.from([0x80 | n.length]), n]);
  }
  return Buffer.concat([Buffer.from([t]), len, body]);
};
const SEQ = (...parts: Buffer[]) => tag(0x30, Buffer.concat(parts));
const INT = (n: number) => tag(0x02, Buffer.from([n]));
const OCTET = (b: Buffer) => tag(0x04, b);
const NULL = Buffer.from([0x05, 0x00]);
const BOOL = (v: boolean) => tag(0x01, Buffer.from([v ? 0xff : 0x00]));
/** OID 2.16.840.1.101.3.4.2.1 — sha256 */
const OID_SHA256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

function timeStampReq(sha256Hex: string, nonce: Buffer): Buffer {
  return SEQ(
    INT(1),                                              // version v1
    SEQ(SEQ(OID_SHA256, NULL), OCTET(Buffer.from(sha256Hex, "hex"))), // messageImprint
    tag(0x02, nonce),                                    // nonce
    BOOL(true)                                           // certReq — include the TSA cert
  );
}

/**
 * Read the PKIStatus and extract the TimeStampToken from a TimeStampResp.
 *
 * TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken [opt] }
 * We only need: status granted (0) or grantedWithMods (1), and the raw DER of
 * the token, which is handed on verbatim for openssl to check.
 */
/** Read a DER tag-length header at `pos`. Returns where the body starts and ends. */
function readTLV(der: Buffer, pos: number): { tag: number; start: number; end: number } {
  const tag = der[pos];
  let i = pos + 1;
  let len = der[i++];
  if (len & 0x80) {
    const k = len & 0x7f;
    len = 0;
    for (let j = 0; j < k; j++) len = (len << 8) | der[i + j];
    i += k;
  }
  return { tag, start: i, end: i + len };
}

function parseResp(der: Buffer): { granted: boolean; status: number; token: Buffer | null } {
  const outer = readTLV(der, 0);
  if (outer.tag !== 0x30) return { granted: false, status: -1, token: null };

  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken OPTIONAL }
  const info = readTLV(der, outer.start);
  if (info.tag !== 0x30) return { granted: false, status: -1, token: null };

  // PKIStatusInfo ::= SEQUENCE { status PKIStatus (INTEGER), ... }
  const statusTlv = readTLV(der, info.start);
  const status = statusTlv.tag === 0x02 ? der[statusTlv.start] : -1;

  // 0 granted, 1 grantedWithMods; anything else is a refusal and carries no token.
  const granted = status === 0 || status === 1;
  if (!granted || info.end >= outer.end) return { granted, status, token: null };

  // The token is the next element, taken verbatim — we hand the exact DER on to
  // openssl rather than re-encoding it, so nothing we do can alter what the TSA
  // signed.
  const tok = readTLV(der, info.end);
  return { granted, status, token: der.subarray(info.end, tok.end) };
}

/**
 * Extract the hash a TimeStampToken actually signed over.
 *
 * The TSTInfo carries messageImprint ::= SEQUENCE { hashAlgorithm, hashedMessage
 * OCTET STRING }. Rather than fully parse the CMS envelope, find the SHA-256
 * AlgorithmIdentifier OID and read the OCTET STRING that follows it — the 32
 * bytes the authority committed to. Returns the hex imprint, or null if no
 * SHA-256 imprint is present (which is itself a reason to reject the token).
 *
 * This is a verification-only read: it never trusts the token, it extracts what
 * the token claims so the caller can compare it to a value computed independently.
 */
export function extractSignedImprint(der: Buffer): string | null {
  // OID 2.16.840.1.101.3.4.2.1 (sha256), DER-encoded.
  const oid = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
  let from = 0;
  // A token can carry the SHA-256 OID in more than one place (e.g. the digest
  // algorithm list). Scan each occurrence and accept the first that is followed,
  // within a short window, by a 32-byte OCTET STRING — the messageImprint shape.
  for (;;) {
    const at = der.indexOf(oid, from);
    if (at < 0) return null;
    const scanEnd = Math.min(der.length - 34, at + 40);
    for (let i = at + oid.length; i <= scanEnd; i++) {
      if (der[i] === 0x04 && der[i + 1] === 0x20) {
        return der.subarray(i + 2, i + 34).toString("hex");
      }
    }
    from = at + 1;
  }
}

/** What the TSA attests: the same tuple the checkpoint signature covers. */
export function checkpointImprint(seq: number, head: string, root: string): string {
  // Over PUBLIC values only — seq, head and root all appear in the transparency
  // feed. org_id used to be in this preimage, which was wrong two ways: anyone
  // holding a candidate org_id (they appear in URLs and tickets) could recompute
  // the imprint and confirm ownership — the exact deanonymisation oracle the
  // random log_id was designed to remove — and an outside auditor, who does NOT
  // have org_id, could not reproduce the imprint to bind the token to the
  // published head at all. Hashing only public values fixes both.
  return crypto.createHash("sha256").update(`checkpoint:${seq}:${head}:${root}`).digest("hex");
}

/**
 * Ask each configured TSA to witness this checkpoint.
 *
 * Never throws and never blocks sealing: a checkpoint with no witness is weaker
 * evidence, but a seal that fails because a third-party server is down is worse
 * — the chain would simply stop being anchored at all. Failures are recorded so
 * the gap is visible rather than assumed away.
 */
export async function witnessCheckpoint(
  orgId: string,
  seq: number,
  head: string,
  root: string
): Promise<WitnessReceipt[]> {
  const imprint = checkpointImprint(seq, head, root);
  const configured = process.env.RUNBACK_TSA_URLS
    ? process.env.RUNBACK_TSA_URLS.split(",").map((u, i) => ({ name: `tsa${i + 1}`, url: u.trim() }))
    : DEFAULT_TSAS;

  const out: WitnessReceipt[] = [];
  for (const tsa of configured) {
    try {
      const nonce = crypto.randomBytes(8);
      const body = timeStampReq(imprint, nonce);
      const res = await fetch(tsa.url, {
        method: "POST",
        headers: { "content-type": "application/timestamp-query" },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.warn(`[witness] ${tsa.name} returned ${res.status}`);
        continue;
      }
      const der = Buffer.from(await res.arrayBuffer());
      const { granted, status, token } = parseResp(der);
      if (!granted || !token) {
        console.warn(`[witness] ${tsa.name} refused (PKIStatus ${status})`);
        continue;
      }

      // Bind the token to OUR imprint before trusting it.
      //
      // Previously we accepted any "granted" response and stored it beside our
      // own computed imprint, never checking the token actually committed to
      // that hash. A malicious TSA — or a MITM on the wire — could return a
      // token time-stamping some other value, and verifyLedger would then
      // announce the checkpoint was "witnessed by an authority Runback does not
      // control", resting that claim on nothing. Extract the messageImprint the
      // token was signed over and require it to equal ours.
      const attested = extractSignedImprint(token);
      if (attested !== imprint) {
        console.warn(
          `[witness] ${tsa.name} token attests ${attested ?? "no readable imprint"}, ` +
          `not our checkpoint imprint ${imprint} — rejecting.`
        );
        continue;
      }

      out.push({
        tsa: tsa.name,
        token: token.toString("base64"),
        imprint,
        requestedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(`[witness] ${tsa.name} unreachable:`, (e as Error).message);
    }
  }
  return out;
}
