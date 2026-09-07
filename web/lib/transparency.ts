/**
 * Public transparency log — publishing checkpoint heads so we cannot equivocate.
 *
 * ── What this adds over time-stamping ──────────────────────────────────────
 * RFC 3161 witnessing (lib/witness.ts) proves a head existed by a time, so we
 * cannot rewrite history and backdate the proof. It cannot stop us sealing TWO
 * divergent chains for one org, honestly time-stamping both, and showing a
 * different one to different parties. A timestamp says nothing about what else
 * exists.
 *
 * Publishing every checkpoint to one append-only feed makes that visible: two
 * different heads claimed for the same (log, seq) are both in the public record,
 * side by side, for anyone who archived it. The database constraint means the
 * second one cannot even be written quietly.
 *
 * ── Why the log id is random, not a hash of org_id ─────────────────────────
 * A hash would be a guess-check oracle: anyone holding an org id — they appear
 * in URLs and support tickets — could confirm whether that org is in the feed
 * and how often it seals. A random identifier reveals nothing but "some
 * workspace sealed a checkpoint", which is the minimum the mechanism needs.
 *
 * ── The feed is itself hash-chained ────────────────────────────────────────
 * Otherwise publishing would just move the trust problem: we could rewrite the
 * feed. Each entry links to the previous, so an observer who archived any
 * earlier feed head can prove the current feed still extends it rather than
 * having been replaced.
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Same canonicalisation as everything else we hash — RFC 8785. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + canonical(o[k]));
  }
  return "{" + parts.join(",") + "}";
}

export interface PublicEntry {
  seq: number;
  log_id: string;
  ckpt_seq: number;
  head_hash: string;
  merkle_root: string;
  prev_hash: string;
  entry_hash: string;
  published_at: string;
}

/**
 * Read-only lookup for UI use (e.g. showing a badge embed snippet) — never
 * mints a row. An org that hasn't sealed a checkpoint yet has no log_id and
 * shouldn't get one just because someone viewed a page; logIdFor() below
 * mints lazily, on the actual first publish.
 */
export async function existingLogIdFor(orgId: string): Promise<string | null> {
  const { data } = await db()
    .from("ad_transparency_ids").select("log_id,published").eq("org_id", orgId).maybeSingle();
  return data?.published ? data.log_id : null;
}

/** The org's opaque public identifier, minted on first publish. */
/**
 * The org's opaque feed identity. `kind: "admin"` returns a SECOND, unrelated
 * id used for administrative-chain heads — deliberately not the same value, so
 * an observer cannot correlate one org's admin-action count against its run
 * count. Same privacy rule this file already applies to org_id.
 */
async function logIdFor(orgId: string, kind: "ledger" | "admin" = "ledger"): Promise<string | null> {
  const col = kind === "admin" ? "admin_log_id" : "log_id";
  const { data } = await db()
    .from("ad_transparency_ids").select("log_id,admin_log_id,published").eq("org_id", orgId).maybeSingle();
  if (data) {
    if (!data.published) return null; // opt-out covers both chains
    const existing = (data as Record<string, string | null>)[col];
    if (existing) return existing;
    // Row exists but this chain has no id yet (the admin column is newer than
    // the row). Mint just that one.
    const minted = "rba_" + crypto.randomBytes(12).toString("hex");
    const { error } = await db()
      .from("ad_transparency_ids").update({ [col]: minted }).eq("org_id", orgId);
    if (error) {
      const { data: again } = await db()
        .from("ad_transparency_ids").select("log_id,admin_log_id").eq("org_id", orgId).maybeSingle();
      return ((again ?? {}) as Record<string, string | null>)[col] ?? null;
    }
    return minted;
  }

  const log_id = "rbl_" + crypto.randomBytes(12).toString("hex");
  const { error } = await db().from("ad_transparency_ids").insert({ org_id: orgId, log_id });
  if (error) {
    // Lost a race — re-read rather than minting a second identity for one org.
    const { data: again } = await db()
      .from("ad_transparency_ids").select("log_id,published").eq("org_id", orgId).maybeSingle();
    return again?.published ? again.log_id : null;
  }
  return log_id;
}

/**
 * Append a checkpoint to the public log.
 *
 * Never throws. A checkpoint that failed to publish is weaker evidence; a seal
 * that failed because publishing failed would leave the chain unanchored, which
 * is worse. Returns null when nothing was published so callers can report the
 * gap rather than assume success.
 */
export async function publishCheckpoint(
  orgId: string,
  ckptSeq: number,
  head: string,
  root: string,
  kind: "ledger" | "admin" = "ledger"
): Promise<PublicEntry | null> {
  try {
    const log_id = await logIdFor(orgId, kind);
    if (!log_id) return null; // opted out

    // Chain from the current feed head.
    const { data: last } = await db()
      .from("ad_transparency_log").select("entry_hash").order("seq", { ascending: false }).limit(1).maybeSingle();
    const prev_hash = last?.entry_hash ?? "";

    const body = { log_id, ckpt_seq: ckptSeq, head_hash: head, merkle_root: root };
    const entry_hash = sha256(prev_hash + canonical(body));

    const { data, error } = await db()
      .from("ad_transparency_log")
      .insert({ ...body, prev_hash, entry_hash })
      .select("seq,log_id,ckpt_seq,head_hash,merkle_root,prev_hash,entry_hash,published_at")
      .single();

    if (error) {
      // A unique violation means this checkpoint is already published. That is
      // benign on a re-seal of the SAME head — and a genuine equivocation
      // attempt if the head differs, which is precisely what the constraint is
      // there to refuse. Say which.
      const { data: existing } = await db()
        .from("ad_transparency_log").select("head_hash")
        .eq("log_id", log_id).eq("ckpt_seq", ckptSeq).maybeSingle();
      if (existing && existing.head_hash !== head) {
        console.error(
          `[transparency] REFUSED: checkpoint ${ckptSeq} already published with a DIFFERENT head ` +
          `(${existing.head_hash.slice(0, 16)}… vs ${head.slice(0, 16)}…). This is an equivocation.`
        );
      }
      return null;
    }
    return data as PublicEntry;
  } catch (e) {
    console.warn("[transparency] publish failed:", (e as Error).message);
    return null;
  }
}

/**
 * The single published feed entry for one org's checkpoint, if any — for
 * surfacing "this checkpoint is independently, publicly visible at feed
 * position N" on a per-run proof bundle without pulling the whole feed.
 */
export async function publicEntryFor(orgId: string, ckptSeq: number): Promise<PublicEntry | null> {
  const { data: idRow } = await db()
    .from("ad_transparency_ids").select("log_id,published").eq("org_id", orgId).maybeSingle();
  if (!idRow?.published) return null;

  const { data } = await db()
    .from("ad_transparency_log")
    .select("seq,log_id,ckpt_seq,head_hash,merkle_root,prev_hash,entry_hash,published_at")
    .eq("log_id", idRow.log_id)
    .eq("ckpt_seq", ckptSeq)
    .maybeSingle();
  return (data as PublicEntry) ?? null;
}

/** A page of the public feed, oldest first. Filters to one log_id when given —
 *  the opaque public identifier, never org_id — so a customer's own badge/page
 *  can show just their entries without exposing the rest of the feed's shape. */
export async function readLog(after = 0, limit = 500, logId?: string): Promise<PublicEntry[]> {
  let q = db()
    .from("ad_transparency_log")
    .select("seq,log_id,ckpt_seq,head_hash,merkle_root,prev_hash,entry_hash,published_at")
    .gt("seq", after)
    .order("seq", { ascending: true })
    .limit(Math.min(Math.max(1, limit), 1000));
  if (logId) q = q.eq("log_id", logId);
  const { data, error } = await q;
  if (error) throw new Error(`could not read the transparency log: ${error.message}`);
  return (data ?? []) as PublicEntry[];
}

export interface LogSummary {
  count: number;
  latest: PublicEntry | null;
}

/**
 * Public summary for one log_id — badge/status-check use. Keyed by the opaque
 * public identifier only (never org_id), consistent with this file's own
 * "reveals nothing but some workspace sealed a checkpoint" design.
 *
 * Deliberately does NOT claim "chain verified": each entry's prev_hash links
 * into the GLOBAL feed shared across every org, so verifying it for real means
 * re-deriving the whole feed (GET /api/transparency's job, and what
 * verifyLogChain does), not something cheap to redo on every badge request.
 * This returns only what's true by construction of a plain read — a count and
 * a timestamp — and leaves the actual cryptographic claim to the full feed.
 */
export async function logSummary(logId: string): Promise<LogSummary> {
  const { data, error } = await db()
    .from("ad_transparency_log")
    .select("seq,log_id,ckpt_seq,head_hash,merkle_root,prev_hash,entry_hash,published_at")
    .eq("log_id", logId)
    .order("ckpt_seq", { ascending: false })
    .limit(1);
  if (error || !data) return { count: 0, latest: null };
  const { count } = await db()
    .from("ad_transparency_log")
    .select("*", { count: "exact", head: true })
    .eq("log_id", logId);
  return { count: count ?? 0, latest: (data[0] as PublicEntry) ?? null };
}

/**
 * Re-derive the feed's own chain.
 *
 * Exported so the published verifier can check the log the same way anyone else
 * would — the feed has to be checkable by its readers, or publishing it only
 * moves the trust problem rather than removing it.
 */
/**
 * Note on `seq`: it is a Postgres sequence and may contain gaps, because a
 * rejected insert still consumes a value — including the refusal that stops an
 * equivocating publish. Completeness is therefore proven by prev_hash linkage,
 * never by contiguous numbering. This function checks the linkage.
 */
export function verifyLogChain(entries: PublicEntry[]): { ok: boolean; brokenAt: number | null } {
  let prev = entries.length && entries[0].seq === 1 ? "" : entries[0]?.prev_hash ?? "";
  for (const e of entries) {
    const expect = sha256(prev + canonical({
      log_id: e.log_id, ckpt_seq: e.ckpt_seq, head_hash: e.head_hash, merkle_root: e.merkle_root,
    }));
    if (expect !== e.entry_hash) return { ok: false, brokenAt: e.seq };
    prev = e.entry_hash;
  }
  return { ok: true, brokenAt: null };
}
