/**
 * Public download of a checkpoint's RFC 3161 time-stamp token.
 *
 * The authenticated route at /api/app/ledger/witness serves a customer their own
 * receipts. This one is deliberately public, because the claim it supports is
 * public: "our ledger is anchored by authorities we do not control." Anyone
 * should be able to check that, and requiring an account to check it would make
 * the claim exactly as trustworthy as the account system — i.e. as trustworthy
 * as us, which is what the anchoring exists to stop mattering.
 *
 * Safe to expose: the token attests one hash. It carries no run content, no org
 * id, no customer name. The imprint it signs is
 * sha256(checkpoint:seq:head:root) over values
 * already published in the transparency feed.
 *
 *   GET /api/transparency/witness?log=rbl_…&ckpt=5              → what exists
 *   GET /api/transparency/witness?log=rbl_…&ckpt=5&tsa=…&download=1  → the .tsr
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const log = req.nextUrl.searchParams.get("log");
  const ckpt = Number(req.nextUrl.searchParams.get("ckpt"));
  if (!log || !Number.isInteger(ckpt)) {
    return NextResponse.json(
      { error: "log and ckpt are required — take them from /api/transparency" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;

  // Resolve the opaque public log id back to an org WITHOUT exposing the org.
  // The mapping stays server-side; the caller only ever sees the log id.
  const { data: ids } = await db
    .from("ad_transparency_ids").select("org_id,published").eq("log_id", log).maybeSingle();
  if (!ids?.org_id || !ids.published) {
    return NextResponse.json({ error: "Unknown log." }, { status: 404 });
  }

  const { data: rows } = await db
    .from("ad_ledger_witnesses").select("tsa,imprint,token_b64,requested_at")
    .eq("org_id", ids.org_id).eq("seq", ckpt);
  const receipts = (rows ?? []) as {
    tsa: string; imprint: string; token_b64: string; requested_at: string;
  }[];
  if (!receipts.length) {
    return NextResponse.json({ error: "No witness receipts for that checkpoint." }, { status: 404 });
  }

  const wanted = req.nextUrl.searchParams.get("tsa");
  if (req.nextUrl.searchParams.get("download")) {
    const r = wanted ? receipts.find((x) => x.tsa === wanted) : receipts[0];
    if (!r) return NextResponse.json({ error: "No such receipt." }, { status: 404 });
    // Verbatim DER, exactly as the authority issued it. Re-encoding would mean
    // the bytes being checked are bytes we produced.
    return new NextResponse(new Uint8Array(Buffer.from(r.token_b64, "base64")), {
      headers: {
        "content-type": "application/timestamp-reply",
        "content-disposition": `attachment; filename="${log}-ckpt${ckpt}-${r.tsa}.tsr"`,
        "cache-control": "public, max-age=3600",
      },
    });
  }

  return NextResponse.json({
    log_id: log,
    ckpt_seq: ckpt,
    witnesses: receipts.map((r) => ({
      tsa: r.tsa,
      requestedAt: r.requested_at,
      imprint: r.imprint,
      download: `/api/transparency/witness?log=${encodeURIComponent(log)}&ckpt=${ckpt}&tsa=${encodeURIComponent(r.tsa)}&download=1`,
    })),
    verify: [
      "Download a token, then read what the authority actually signed:",
      "  openssl ts -reply -in <file>.tsr -token_in -text",
      "",
      "'Message data' in that output is the imprint above. It is",
      "sha256(checkpoint:ckpt_seq:head_hash:merkle_root) — all three values",
      "are in /api/transparency, so the token binds to the published entry.",
      "",
      "The timestamp is issued by an authority Runback does not control and",
      "cannot backdate. A chain rewritten after the fact would have a different",
      "head, and would need a token dated earlier than it could have been issued.",
    ],
  });
}
