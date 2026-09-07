import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordCheck, lastCheck, pruneChecks, checkCapacity } from "@/lib/uptime";
import { sendAlertEmail } from "@/lib/email";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Record an availability sample, and email on a STATE CHANGE.
 *
 * On transitions only — not on every failed check. A five-minute cron mailing
 * on each failure sends twelve messages an hour during an incident, which
 * trains you to filter the address, which means you miss the next one. One
 * message when it breaks, one when it recovers.
 *
 * The check exercises the dependency every request needs rather than pinging
 * the process: a deployment that is up but cannot reach Postgres is not
 * serving, and recording that as healthy would make the whole record a lie.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const previous = await lastCheck().catch(() => null);

  const started = Date.now();
  let ok = false;
  let detail: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { error } = await sb.from("orgs").select("id", { count: "exact", head: true }).limit(1);
    ok = !error;
    if (error) detail = `database unreachable: ${error.message}`;
  } catch (e) {
    detail = `database check threw: ${(e as Error).message}`;
  }
  const latency = Date.now() - started;

  await recordCheck(ok, latency, detail);

  // Transition only. `previous === null` is first-ever run, not a recovery.
  const changed = previous !== null && previous.ok !== ok;
  const to = process.env.OPS_ALERT_EMAIL;
  if (changed && to) {
    await sendAlertEmail(
      to,
      ok ? "Recovered — Runback is responding again" : "DOWN — Runback is not serving",
      ok
        ? [`Availability restored at ${new Date().toISOString()}.`, `Response time ${latency}ms.`]
        : [`Health check failed at ${new Date().toISOString()}.`, detail ?? "No detail available.", "Status page: https://runback.dev/status"]
    ).catch((e) => console.error("[uptime] alert email failed:", e));
  }
  if (changed && !to) {
    console.error(`[uptime] state changed to ${ok ? "up" : "DOWN"} and OPS_ALERT_EMAIL is not set`);
  }

  // Housekeeping once an hour rather than on a random draw, so behaviour is
  // reproducible and a prune can be reasoned about from the clock alone.
  const hourly = new Date().getUTCMinutes() < 5;
  const pruned = hourly ? await pruneChecks() : 0;

  // Capacity is checked once a day, on this cron rather than its own, because
  // it needs a heartbeat and one already exists. It raises a tracked fault
  // instead of an email, so the notification is deduped and arrives once.
  const daily = hourly && new Date().getUTCHours() === 6;
  const capacity = daily ? await checkCapacity().catch(() => []) : [];

  return NextResponse.json({ ok, latency_ms: latency, changed, pruned, capacity });
}
