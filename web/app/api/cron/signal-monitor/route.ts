/**
 * Signal monitor cron — runs once a day (vercel.json: `0 7 * * *`).
 * Fetches RSS feeds for regulatory, model-release, and incident signals.
 * Writes novel entries to marketing_signals (deduplicated by URL).
 * Also generates a weekly fleet signal from live DB data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustCount, tryRead } from "@/lib/supabase/read";
import { mustWrite } from "@/lib/supabase/write";
import type { SignalType } from "@/lib/socialContent";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The shared client carries no generated row types, so every query builder
 * infers `never` payloads. Same escape hatch as lib/auth.ts:29 — safety comes
 * from the explicit row shapes at each call site plus mustRead/mustWrite.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

// ── RSS parser ───────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const match of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const get = (tag: string): string => {
      const m = block.match(
        new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`)
      );
      return ((m?.[1] ?? m?.[2]) || "").trim();
    };
    const link = get("link") || get("guid");
    if (!link) continue;
    items.push({ title: get("title"), link, description: get("description"), pubDate: get("pubDate") });
  }
  return items;
}

// ── Feed definitions ─────────────────────────────────────────────────────────

const FEEDS: Array<{
  url: string;
  type: SignalType;
  source: string;
  filter: (title: string, desc: string) => boolean;
}> = [
  {
    url: "https://openai.com/blog/rss.xml",
    type: "model_release",
    source: "openai-blog",
    filter: (t) => /\b(gpt|o\d|model|api|voice|realtime|reasoning)\b/i.test(t),
  },
  {
    url: "https://blogs.microsoft.com/on-the-issues/feed/",
    type: "regulatory",
    source: "microsoft-policy",
    filter: (t) => /\b(ai act|governance|regulation|compliance|audit)\b/i.test(t),
  },
  {
    url: "https://incidentdatabase.ai/rss.xml",
    type: "incident",
    source: "aiid",
    filter: () => true,
  },
];

// ── Fetch + parse one feed ───────────────────────────────────────────────────

interface FeedResult {
  items: RssItem[];
  /** Set when the feed could not be read at all — distinct from "no new items". */
  failure?: string;
}

async function fetchFeed(feed: (typeof FEEDS)[0]): Promise<FeedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { "User-Agent": "Runback-SignalMonitor/1.0 (https://runback.dev)" },
    });
    clearTimeout(timer);
    if (!res.ok) return { items: [], failure: `HTTP ${res.status}` };
    const xml = await res.text();
    const parsed = parseRss(xml);
    // Parsed nothing at all from a 200 means the feed moved or changed format —
    // a real failure that used to look identical to "nothing new this run".
    if (!parsed.length) return { items: [], failure: "200 but no <item> elements — feed moved or reformatted?" };
    return { items: parsed.filter((item) => feed.filter(item.title, item.description)) };
  } catch (e) {
    clearTimeout(timer);
    return { items: [], failure: e instanceof Error ? e.message : "fetch threw" };
  }
}

// ── Fleet weekly signal ──────────────────────────────────────────────────────

async function maybeEmitFleetSignal(
  sb: ReturnType<typeof getAdminClient>
): Promise<{ inserted: boolean }> {
  const client = sb as SbClient;

  // Only emit once per week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const already = await mustCount(
    client
      .from("marketing_signals")
      .select("id", { count: "exact", head: true })
      .eq("type", "fleet_weekly")
      .gte("created_at", weekAgo),
    "signal-monitor: check for this week's fleet signal"
  );

  if (already > 0) return { inserted: false };

  const runs = await mustCount(
    client.from("ad_runs").select("run_id", { count: "exact", head: true }).gte("started_at", weekAgo),
    "signal-monitor: count fleet runs"
  );

  if (runs < 10) return { inserted: false };

  // ad_policy_causes is a daily rollup keyed (org_id, day, policy_name, agent)
  // with block_count / run_count. It has no `cause_type` and no `created_at`, so
  // this query 400'd on every run and `.single()` on the error left topCauseRow
  // null — meaning every fleet signal ever emitted said "policy deviation".
  const causeRows = await tryRead<Array<{ policy_name: string; block_count: number }>>(
    client.from("ad_policy_causes").select("policy_name, block_count").gte("day", weekAgo.slice(0, 10)),
    "signal-monitor: load policy causes",
    []
  );
  const blocksByPolicy = new Map<string, number>();
  for (const r of causeRows) {
    blocksByPolicy.set(r.policy_name, (blocksByPolicy.get(r.policy_name) ?? 0) + (r.block_count ?? 0));
  }
  const topCause =
    [...blocksByPolicy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.replace(/[_-]+/g, " ") ??
    "policy deviation";

  const weekKey = new Date().toISOString().slice(0, 10);

  await mustWrite(
    client.from("marketing_signals").insert({
      type: "fleet_weekly",
      source: "fleet",
      title: `Fleet weekly: ${runs.toLocaleString()} decisions sealed`,
      summary: `Top signal this week: ${topCause}`,
      url: `fleet://weekly/${weekKey}`,
      metadata: { run_count: runs, top_cause: topCause },
    }),
    "signal-monitor: insert fleet weekly signal"
  );

  return { inserted: true };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getAdminClient();
  const results: Record<string, number> = {};
  // A source that cannot be read is an operational problem, not a quiet week.
  const failures: Record<string, string> = {};

  // Pull and deduplicate all feed items
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  for (let i = 0; i < FEEDS.length; i++) {
    const feed = FEEDS[i];
    const s = settled[i];
    const result: FeedResult = s.status === "fulfilled" ? s.value : { items: [], failure: String(s.reason) };
    if (result.failure) {
      failures[feed.source] = result.failure;
      console.error(`[signal-monitor] ${feed.source} (${feed.url}) unreadable: ${result.failure}`);
    }
    const items = result.items;
    if (!items.length) { results[feed.source] = 0; continue; }

    let inserted = 0;
    for (const item of items.slice(0, 5)) {
      const { error } = await (sb as SbClient).from("marketing_signals").insert({
        type: feed.type,
        source: feed.source,
        title: item.title.slice(0, 300),
        summary: item.description.replace(/<[^>]+>/g, "").slice(0, 600),
        url: item.link,
        metadata: { pub_date: item.pubDate },
      });
      if (!error) {
        inserted++;
      } else if (error.code !== "23505") {
        // 23505 = unique URL constraint, an expected duplicate skip — anything else is a real failure
        console.error(`[signal-monitor] insert failed for ${feed.source}:`, error);
      }
    }
    results[feed.source] = inserted;
  }

  const { inserted: fleetInserted } = await maybeEmitFleetSignal(sb);
  results["fleet"] = fleetInserted ? 1 : 0;

  return NextResponse.json({
    ok: Object.keys(failures).length === 0,
    signals: results,
    ...(Object.keys(failures).length ? { failures } : {}),
  });
}
