/**
 * The public transparency log.
 *
 * Deliberately unauthenticated: a log only constrains us if outsiders can read
 * and archive it. Anyone monitoring this feed can detect two different heads
 * published for the same (log_id, ckpt_seq) — which is what stops us
 * equivocating, i.e. keeping two divergent histories and showing a different
 * one to each party. Time-stamping alone cannot catch that.
 *
 * What it exposes is deliberately minimal: an opaque per-workspace identifier
 * (random, not derived from anything), a checkpoint sequence, and two hashes.
 * No run content, no customer names, nothing reversible.
 *
 *   GET /api/transparency              → newest page + feed head
 *   GET /api/transparency?after=100    → entries after seq 100
 *   GET /api/transparency?log=rbl_xxx  → just one workspace's own entries
 */
import { NextRequest, NextResponse } from "next/server";
import { readLog, verifyLogChain } from "@/lib/transparency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const after = Number(req.nextUrl.searchParams.get("after") ?? 0);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 500);
  const logId = req.nextUrl.searchParams.get("log") ?? undefined;

  let entries;
  try {
    entries = await readLog(Number.isFinite(after) ? after : 0, Number.isFinite(limit) ? limit : 500, logId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }

  // Check our own chain before serving it. A feed that fails its own check
  // should say so rather than let a reader discover it — the whole point is
  // that readers do not have to trust us, and hiding a break would be the one
  // thing that makes this worse than not publishing at all.
  //
  // Only meaningful on the UNFILTERED feed: each entry's prev_hash links into
  // the single global chain shared across every org, so a log_id-filtered
  // slice skips other orgs' interleaved entries and would show spurious
  // breaks between two genuinely-fine entries that just aren't adjacent in
  // the real chain. Filtered requests get an honest "not checked here"
  // instead of a wrong verdict.
  const chain = logId ? null : verifyLogChain(entries);

  return NextResponse.json(
    {
      log: "runback-transparency/v1",
      note:
        "Append-only public record of every sealed ledger checkpoint. Each entry links to " +
        "the previous by hash, so this feed cannot be silently rewritten. Two different " +
        "head_hash values for the same (log_id, ckpt_seq) would be proof that Runback kept " +
        "two divergent histories — archive this feed and check.",
      // Said explicitly because the alternative is a reader quietly concluding
      // an entry was removed — the single worst impression a transparency log
      // can give, and here it would be wrong.
      on_seq_gaps:
        "`seq` is a Postgres sequence and MAY contain gaps: a rejected insert — " +
        "notably a refused attempt to publish a second, different head for a " +
        "checkpoint already in the log — still consumes a value. Completeness is " +
        "NOT proven by seq being contiguous. It is proven by prev_hash linkage: " +
        "each entry's prev_hash equals the previous entry's entry_hash, so removing " +
        "an entry breaks the chain and is detectable. Check chain_ok, not the numbering.",
      count: entries.length,
      head: entries.length ? entries[entries.length - 1].entry_hash : null,
      chain_ok: chain ? chain.ok : null,
      chain_broken_at: chain ? chain.brokenAt : null,
      ...(logId && {
        chain_note:
          "This view is filtered to one workspace (?log=), so entries are not adjacent in " +
          "the real global chain and chain_ok cannot be computed here — fetch the unfiltered " +
          "feed (omit ?log=) to verify the full chain, which includes every entry shown here.",
      }),
      verify:
        "entry_hash = sha256(prev_hash + RFC8785(" +
        '{"ckpt_seq","head_hash","log_id","merkle_root"}))',
      // The time-stamp tokens are public too. A claim that can only be checked
      // by someone with an account is only as good as the account system —
      // i.e. as good as trusting us, which is what anchoring exists to avoid.
      witness_tokens:
        "/api/transparency/witness?log=<log_id>&ckpt=<ckpt_seq> — RFC 3161 tokens " +
        "from authorities Runback does not control. Verify with: " +
        "openssl ts -reply -in <file>.tsr -token_in -text",
      entries,
    },
    {
      headers: {
        // Cacheable, but briefly: an archiver should get a current view.
        "cache-control": "public, max-age=60",
        "content-type": "application/json",
      },
    }
  );
}
