import { NextRequest, NextResponse } from "next/server";
import { verifyAuditRecord, type AuditRecord } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Re-verify the integrity (and signature, if a key is configured) of an audit record. */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(`audit_verify:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    });
  }

  // Bound the body before parsing it.
  //
  // This endpoint is unauthenticated by design — verifying a record must not
  // require an account — and verification is O(n) hashing over every event. A
  // 20/min/IP limit caps request COUNT but says nothing about request SIZE, so
  // twenty 100MB records would have been twenty full chain recomputations.
  // 8MB is far above any real cassette: the sample is ~12KB, and a run with
  // thousands of steps is still well under it.
  const MAX_BYTES = 8 * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return NextResponse.json(
      { error: `Record too large — the limit is ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 413 }
    );
  }

  let record: AuditRecord;
  try {
    // content-length can be absent or wrong on a chunked request, so measure
    // what actually arrived rather than trusting the header alone.
    const raw = await req.text();
    if (raw.length > MAX_BYTES) {
      return NextResponse.json(
        { error: `Record too large — the limit is ${MAX_BYTES / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }
    record = JSON.parse(raw) as AuditRecord;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!record?.manifest || !Array.isArray(record.events)) {
    return NextResponse.json({ error: "Not a Runback audit record" }, { status: 400 });
  }
  return NextResponse.json(verifyAuditRecord(record));
}
