/**
 * Core hashing/canonicalization primitives — used by both the Community
 * cassette basics (cassette.ts) and the commercially-licensed H2 salience
 * projection (cassette-enterprise.ts). Split out specifically so those two
 * files don't import from each other in a cycle: cassette.ts needs
 * cassette-enterprise.ts's toolKeyP/llmKeyP for oracleEntryOf, and
 * cassette-enterprise.ts needs canonical/sha256 — this file is the shared
 * base both depend on instead of depending on each other for it.
 */
import { createHash } from "crypto";

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
export function canonical(v: unknown): string {
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

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
