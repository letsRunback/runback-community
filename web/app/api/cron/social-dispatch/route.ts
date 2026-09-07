/**
 * Social dispatch cron — runs once a day (vercel.json: `0 10 * * *`).
 * Reads unprocessed signals from marketing_signals, generates platform-specific
 * copy, and queues posts via Buffer. Posts one signal per run to avoid flooding.
 *
 * The daily schedule, this header, and POST_GAP_HOURS below used to disagree
 * (the header claimed 12-hourly). One signal per day, with a 20h floor between
 * posts, is the intended cadence — the gap check is the belt to the schedule's
 * braces, so a manual trigger cannot double-post.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustWrite } from "@/lib/supabase/write";
import { getProfiles, createPost, waitForPost } from "@/lib/buffer";
import { generatePost, imageForSignal, type Platform, type SocialSignal } from "@/lib/socialContent";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
// Was 60 — waitForPost's verification polling (up to ~45s) needs headroom
// alongside the rest of the route's work, or the function itself gets cut
// off before it can find out whether the post it just created is real.
export const maxDuration = 90;

/**
 * The shared client carries no generated row types, so query builders infer
 * `never` payloads. Same escape hatch as lib/auth.ts:29 — safety comes from the
 * explicit row shapes at each call site plus mustWrite.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

// Minimum gap between posts on the same platform (in hours)
const POST_GAP_HOURS = 20;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!bufferToken) {
    console.error("[social-dispatch] BUFFER_ACCESS_TOKEN not set");
    return NextResponse.json({ ok: false, reason: "BUFFER_ACCESS_TOKEN not set" });
  }

  let sb: ReturnType<typeof getAdminClient>;
  try {
    sb = getAdminClient();
  } catch (e) {
    console.error("[social-dispatch] getAdminClient failed:", e);
    return NextResponse.json({ error: `getAdminClient: ${e}` }, { status: 500 });
  }

  // Pick one unprocessed signal — oldest first, only signals > 30 min old
  // (give the monitor cron time to settle before dispatching)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: rows, error: fetchErr } = await (sb as SbClient)
    .from("marketing_signals")
    .select("*")
    .eq("processed", false)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(1);

  if (fetchErr) {
    console.error("[social-dispatch] marketing_signals fetch failed:", fetchErr);
    return NextResponse.json({ error: String(fetchErr) }, { status: 500 });
  }
  if (!rows?.length) return NextResponse.json({ ok: true, reason: "no pending signals" });

  const signal = rows[0] as {
    id: string;
    type: string;
    title: string;
    summary: string | null;
    url: string | null;
    metadata: Record<string, unknown>;
  };

  // Get Buffer profiles
  let profiles: Awaited<ReturnType<typeof getProfiles>>;
  try {
    profiles = await getProfiles(bufferToken);
  } catch (e) {
    console.error("[social-dispatch] Buffer getProfiles failed:", e);
    return NextResponse.json({ error: `Buffer profiles: ${e}` }, { status: 502 });
  }

  // The Buffer org this token belongs to has channels for more than one of
  // our own brands (e.g. a dormant "Enterprise Architecture AI Patterns"
  // channel alongside the real Runback one) — every previously-successful
  // run posted Runback-specific copy and imagery to ALL connected channels
  // regardless of which brand they belong to, because nothing here ever
  // scoped the channel list. BUFFER_CHANNEL_ALLOWLIST (comma-separated
  // Buffer channel ids or channel names, case-insensitive) restricts
  // dispatch to just the intended channel(s). Leaving it unset preserves
  // the old post-to-everything behavior — set it before re-enabling the
  // cron, not after.
  const allowlistRaw = process.env.BUFFER_CHANNEL_ALLOWLIST;
  const allowlist = allowlistRaw
    ? allowlistRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;
  if (allowlist) {
    const before = profiles.length;
    profiles = profiles.filter(
      (p) => allowlist.includes(p.id.toLowerCase()) || allowlist.includes(p.service_username.toLowerCase())
    );
    console.warn(
      `[social-dispatch] BUFFER_CHANNEL_ALLOWLIST scoped ${before} connected channel(s) down to ${profiles.length}: ${profiles.map((p) => `${p.service_username} (${p.service})`).join(", ") || "none matched"}`
    );
  } else {
    console.warn(
      `[social-dispatch] BUFFER_CHANNEL_ALLOWLIST is not set — posting to ALL ${profiles.length} connected Buffer channel(s): ${profiles.map((p) => `${p.service_username} (${p.service})`).join(", ")}. Set it to scope this to Runback's own channel(s) only.`
    );
  }

  // Every previously-successful run also posted to two separate "linkedin"
  // channels within whatever set survives the allowlist above — that's not
  // a bug in this route (it posts once per connected Buffer channel, which
  // is correct), but it's easy to mistake for double-posting from the
  // outside. Log it loudly so a genuinely-accidental duplicate channel
  // connection in Buffer shows up here instead of only being discoverable
  // by counting buffer_post_ids in the database.
  const byService = new Map<string, string[]>();
  for (const p of profiles) {
    byService.set(p.service, [...(byService.get(p.service) ?? []), `${p.id} (${p.service_username})`]);
  }
  for (const [service, ids] of byService) {
    if (ids.length > 1) {
      console.warn(
        `[social-dispatch] ${ids.length} Buffer channels connected for service "${service}" — every run posts to ALL of them: ${ids.join(", ")}. If this is unintentional, disconnect the extra channel in Buffer, not here.`
      );
    }
  }

  // Check whether we posted too recently on any profile
  const gapCutoff = new Date(Date.now() - POST_GAP_HOURS * 60 * 60 * 1000).toISOString();
  const { count: recentPosts } = await (sb as SbClient)
    .from("marketing_signals")
    .select("id", { count: "exact", head: true })
    .eq("processed", true)
    .gte("processed_at", gapCutoff);

  if ((recentPosts ?? 0) > 0) {
    return NextResponse.json({ ok: true, reason: `rate-limited: posted within ${POST_GAP_HOURS}h` });
  }

  const socialSignal: SocialSignal = {
    type: signal.type as SocialSignal["type"],
    title: signal.title,
    summary: signal.summary,
    url: signal.url,
    metadata: signal.metadata,
  };

  // Map Buffer service names to our Platform type. "x" covers accounts
  // connected after Buffer updated its service identifier for the
  // Twitter/X rebrand — without this alias, an X channel is silently
  // treated as "no copy generator for this service" and skipped every
  // single run with no error, which is indistinguishable from the channel
  // just not being connected at all.
  const platformMap: Record<string, Platform> = {
    linkedin: "linkedin",
    twitter: "twitter",
    x: "twitter",
    bluesky: "bluesky",
  };

  const postIds: Array<{ platform: string; id: string }> = [];
  const failures: Array<{ platform: string; error: string }> = [];
  const skipped: string[] = [];

  // Post to each connected profile
  for (const profile of profiles) {
    const platform = platformMap[profile.service];
    if (!platform) {
      // A Buffer channel we have no copy generator for (instagram, facebook, …).
      // Not a failure, but it must not count as "delivered" either.
      skipped.push(profile.service);
      continue;
    }

    const text = await generatePost(socialSignal, platform);

    try {
      const posts = await createPost(bufferToken, [profile.id], text, {
        link: signal.url ?? undefined,
        image: imageForSignal(socialSignal),
      });
      // createPost's mutation can return a clean success with a real-looking
      // post id for a post that does not actually exist — found by direct
      // investigation after a signal was marked delivered and the post was
      // nowhere in Buffer or on LinkedIn. Re-querying it back is the only way
      // to know it actually persisted; waitForPost polls rather than checking
      // once, since Buffer's own processing (e.g. fetching the social-card
      // image) was observed still happening nearly a minute after creation.
      for (const p of posts) {
        const check = await waitForPost(bufferToken, p.id);
        if (!check.exists) {
          console.error(`[social-dispatch] Buffer accepted the post for ${profile.service} (id ${p.id}) but it does not exist on verification — treating as failed, not delivered.`);
          failures.push({ platform: profile.service, error: `created but not found on verification: ${check.error ?? "unknown"}` });
          continue;
        }
        if (check.error) {
          console.error(`[social-dispatch] Buffer post ${p.id} for ${profile.service} has a publishing error: ${check.error}`);
          failures.push({ platform: profile.service, error: check.error });
          continue;
        }
        postIds.push({ platform: profile.service, id: p.id });
      }
    } catch (e) {
      console.error(`[social-dispatch] Buffer post to ${profile.service} failed:`, e);
      failures.push({ platform: profile.service, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Only retire the signal if something actually went out.
  //
  // This used to mark `processed: true` unconditionally — so a run where every
  // Buffer call threw, or where no connected channel matched platformMap, still
  // burned the signal. It could never be picked up again, and the failure was
  // invisible because the response also said `ok: true`. Leaving it pending
  // means the next run retries it; the 20h gap check upstream stops that from
  // becoming a hot loop.
  if (postIds.length === 0) {
    console.error(
      `[social-dispatch] signal ${signal.id} not dispatched — ` +
        `${failures.length} failed, ${skipped.length} unsupported channel(s). Leaving pending for retry.`
    );
    return NextResponse.json(
      {
        ok: false,
        signal_id: signal.id,
        signal_type: signal.type,
        reason: failures.length ? "all posts failed" : "no supported channel connected",
        failures,
        skipped_services: skipped,
      },
      { status: failures.length ? 502 : 200 }
    );
  }

  await mustWrite(
    (sb as SbClient)
      .from("marketing_signals")
      .update({ processed: true, processed_at: new Date().toISOString(), buffer_post_ids: postIds })
      .eq("id", signal.id),
    `social-dispatch: mark signal ${signal.id} processed`
  );

  return NextResponse.json({
    ok: true,
    signal_id: signal.id,
    signal_type: signal.type,
    platforms_posted: postIds.map((p) => p.platform),
    failures,
    skipped_services: skipped,
  });
}
