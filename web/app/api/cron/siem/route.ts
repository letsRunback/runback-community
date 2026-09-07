import { NextRequest, NextResponse } from "next/server";
import { exportAll } from "@/lib/siem";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ship new platform audit events to each org's SIEM collector.
 *
 * Runs often — hourly rather than nightly — because a security feed that
 * arrives a day late is not much use for detection, which is the reason a SOC
 * asked for it. Delivery is at-least-once from a per-sink watermark, so a
 * failed run re-sends rather than skipping.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const results = await exportAll();
    const delivered = results.reduce((n, r) => n + r.delivered, 0);
    const failed = results.filter((r) => r.error);
    // Reported, not swallowed: a silently dead security feed is the failure
    // mode this whole feature exists to avoid.
    if (failed.length) {
      console.error(`[siem] ${failed.length} sink(s) failed:`, failed.map((f) => `${f.orgId}: ${f.error}`).join("; "));
    }
    return NextResponse.json({ ok: true, sinks: results.length, delivered, failed: failed.length });
  } catch (e) {
    console.error("[siem] export run failed:", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
