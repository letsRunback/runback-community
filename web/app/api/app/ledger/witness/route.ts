/**
 * Download the raw RFC 3161 time-stamp token for a checkpoint.
 *
 * The point of external witnessing is that a customer does not have to trust
 * our verifier — so the token is served exactly as the authority issued it,
 * and the response says how to check it with `openssl`, a tool we do not ship
 * and cannot influence. An auditor should be able to confirm our ledger was not
 * re-sealed after the fact using nothing from us but the bytes.
 *
 *   GET /api/app/ledger/witness?seq=4            → JSON: what exists
 *   GET /api/app/ledger/witness?seq=4&tsa=freetsa.org&download=1  → the .tsr
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTenantClient } from "@/lib/supabase/tenant";
import { checkpointImprint } from "@/lib/witness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const seq = Number(req.nextUrl.searchParams.get("seq"));
  if (!Number.isInteger(seq) || seq < 1) {
    return NextResponse.json({ ok: false, error: "A checkpoint seq is required." }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getTenantClient(session.orgId).client as any;
  const { data, error } = await db
    .from("ad_ledger_witnesses")
    .select("tsa,imprint,token_b64,requested_at")
    .eq("org_id", session.orgId)
    .eq("seq", seq);
  if (error) {
    console.error("[api/app/ledger/witness] witnesses query failed:", error.message);
    return NextResponse.json({ ok: false, error: "Could not load witness receipts" }, { status: 500 });
  }
  const receipts = (data ?? []) as {
    tsa: string; imprint: string; token_b64: string; requested_at: string;
  }[];

  const wanted = req.nextUrl.searchParams.get("tsa");
  if (req.nextUrl.searchParams.get("download")) {
    const r = wanted ? receipts.find((x) => x.tsa === wanted) : receipts[0];
    if (!r) return NextResponse.json({ ok: false, error: "No such receipt." }, { status: 404 });
    // Verbatim DER. Re-encoding it here would mean the bytes an auditor checks
    // are bytes we produced, which defeats the purpose.
    return new NextResponse(new Uint8Array(Buffer.from(r.token_b64, "base64")), {
      headers: {
        "content-type": "application/timestamp-reply",
        "content-disposition": `attachment; filename="runback-checkpoint-${seq}-${r.tsa}.tsr"`,
      },
    });
  }

  // Recompute what the TSA should have signed, so the caller can compare rather
  // than take our word for the linkage between token and checkpoint.
  //
  // The `error` here used to be discarded — a DB error on this lookup fell
  // through to `expectedImprint: null` with `ok: true`, indistinguishable from
  // "no checkpoint at this seq." On an endpoint whose entire purpose is
  // letting an auditor verify without trusting us, silently reporting a
  // server failure as a clean (if empty) answer is the one failure mode this
  // route cannot afford.
  const { data: cp, error: cpError } = await db
    .from("ad_ledger_checkpoints")
    .select("head_hash,merkle_root")
    .eq("org_id", session.orgId).eq("seq", seq).maybeSingle();
  if (cpError) {
    return NextResponse.json({ ok: false, error: cpError.message }, { status: 500 });
  }

  const expectedImprint = cp
    ? checkpointImprint(seq, cp.head_hash, cp.merkle_root)
    : null;

  return NextResponse.json({
    ok: true,
    seq,
    expectedImprint,
    witnesses: receipts.map((r) => ({
      tsa: r.tsa,
      requestedAt: r.requested_at,
      imprint: r.imprint,
      // If these disagree, the token attests something other than this
      // checkpoint and proves nothing about it.
      imprintMatchesCheckpoint: expectedImprint ? r.imprint === expectedImprint : null,
      download: `/api/app/ledger/witness?seq=${seq}&tsa=${encodeURIComponent(r.tsa)}&download=1`,
    })),
    howToVerifyWithoutUs: [
      "1. Download the token (the download link above).",
      "2. Read what the authority actually signed:",
      "     openssl ts -reply -in <file>.tsr -token_in -text",
      "3. Confirm 'Message data' equals expectedImprint above, which is",
      `     sha256("checkpoint:<seq>:<head_hash>:<merkle_root>") — all public, from /api/transparency`,
      "4. Verify the authority's signature against its own CA chain:",
      "     openssl ts -verify -in <file>.tsr -token_in -data <imprint-bytes> -CAfile <tsa-ca.pem>",
      "",
      "Nothing in steps 2-4 uses Runback software. That is the point: the",
      "time stamp is issued by an authority we do not control, so we cannot",
      "backdate it — a chain re-sealed after the fact would need a token for a",
      "different head, dated earlier than it could possibly have been issued.",
    ],
  });
}
