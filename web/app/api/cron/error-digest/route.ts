import { NextRequest, NextResponse } from "next/server";
import { unnotifiedErrors, markNotified } from "@/lib/errorTracking";
import { sendAlertEmail } from "@/lib/email";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Tell the operator about faults they have not seen yet.
 *
 * Storing errors only converts "a customer told us" into "we could have looked
 * it up". The gap this closes is being TOLD — so notification, not a dashboard,
 * is the deliverable. Runs every 15 minutes.
 *
 * Notifies once per distinct fault, not once per occurrence: a broken query
 * firing ten thousand times must produce one message saying ten thousand, or
 * the alert channel becomes noise and stops being read — the same failure as
 * having no alerting, arrived at more expensively.
 *
 * Delivery is by email to OPS_ALERT_EMAIL (Resend is already configured), or
 * to OPS_ALERT_WEBHOOK if you would rather it went to a chat channel. Email is
 * the default because it needs no additional service — a fault nobody is told
 * about is the state this exists to end, and that should not depend on having
 * adopted a particular chat tool.
 *
 * With neither set, errors are still recorded and queryable; only the push is
 * off, and the cron says so loudly rather than accumulating them in silence.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhook = process.env.OPS_ALERT_WEBHOOK;
  const email = process.env.OPS_ALERT_EMAIL;
  try {
    const fresh = await unnotifiedErrors(20);
    if (!fresh.length) return NextResponse.json({ ok: true, new_faults: 0, notified: false });

    if (!webhook && !email) {
      // Loud rather than silent: unreported errors accumulating with nobody
      // watching is the state this whole feature exists to end.
      console.error(
        `[error-digest] ${fresh.length} unreported fault(s) and neither OPS_ALERT_EMAIL nor OPS_ALERT_WEBHOOK is set:`,
        fresh.map((e) => `${e.route ?? "-"} ${e.name}: ${e.message.slice(0, 80)}`).join(" | ")
      );
      return NextResponse.json({ ok: true, new_faults: fresh.length, notified: false, reason: "no operator alert destination configured" });
    }

    const subject = `${fresh.length} new fault${fresh.length === 1 ? "" : "s"} in production`;

    if (email) {
      const ok = await sendAlertEmail(
        email,
        subject,
        fresh.map((e) => `${e.name} on ${e.route ?? "unknown route"} — seen ${e.occurrences}x — ${e.message.slice(0, 200)}`)
      );
      // Not marked notified on failure: an undelivered digest must be retried,
      // not quietly dropped, or the fault goes unreported forever.
      if (!ok) {
        console.error("[error-digest] email delivery failed");
        return NextResponse.json({ ok: false, new_faults: fresh.length, notified: false }, { status: 502 });
      }
      await markNotified(fresh.map((e) => e.id));
      return NextResponse.json({ ok: true, new_faults: fresh.length, notified: true, via: "email" });
    }

    const lines = fresh.map(
      (e) => `• *${e.name}* on \`${e.route ?? "unknown route"}\` ×${e.occurrences} — ${e.message.slice(0, 160)}`
    );
    const res = await fetch(webhook!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `*Runback: ${fresh.length} new fault${fresh.length === 1 ? "" : "s"}*\n${lines.join("\n")}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Not marked notified — an undelivered digest must be retried, not lost.
      console.error(`[error-digest] webhook returned ${res.status}`);
      return NextResponse.json({ ok: false, new_faults: fresh.length, notified: false }, { status: 502 });
    }

    await markNotified(fresh.map((e) => e.id));
    return NextResponse.json({ ok: true, new_faults: fresh.length, notified: true });
  } catch (e) {
    console.error("[error-digest] run failed:", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
