#!/usr/bin/env -S npx tsx
/**
 * native-audit — fuse a native libc recording into a signed, verifiable audit.
 *
 *   # convert a native cassette → signed audit record (set AUDIT_SIGNING_KEY to sign)
 *   AUDIT_SIGNING_KEY=… npx tsx native-audit.ts --in run.cassette --out run.audit.json
 *
 *   # re-verify an audit record (exit 0 iff the recording reproduces its digest)
 *   AUDIT_SIGNING_KEY=… npx tsx native-audit.ts --verify run.audit.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { cassetteFromNativeLog, buildNativeAuditRecord, verifyNativeAuditRecord } from "../src/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const key = process.env.AUDIT_SIGNING_KEY;
const verifyPath = arg("verify");

if (verifyPath) {
  const rec = JSON.parse(readFileSync(verifyPath, "utf8"));
  const v = verifyNativeAuditRecord(rec, key);
  console.log(
    `${v.valid ? "✅ verified" : "❌ INVALID"} — digest ${v.checks.digest ? "ok" : "MISMATCH"}, signature ${v.checks.signature}`
  );
  process.exit(v.valid ? 0 : 1);
}

const inPath = arg("in");
if (!inPath) {
  console.error("usage: native-audit --in <native.cassette> [--out <audit.json>] | --verify <audit.json>");
  process.exit(2);
}

const text = readFileSync(inPath, "utf8");
const cassette = cassetteFromNativeLog(text, arg("run") || "native");
const rec = buildNativeAuditRecord(cassette, key ? { signingKey: key } : undefined);
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(rec, null, 2));
console.log(
  `cassette ${cassette.entry_count} interactions · digest ${cassette.digest.slice(0, 16)}… · signed=${rec.manifest.signed}${out ? ` → ${out}` : ""}`
);
