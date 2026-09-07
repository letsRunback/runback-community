/**
 * A live, embeddable status badge for one workspace's public transparency log
 * — the same rendering pattern as Shields.io/OpenSSF Scorecard badges: an SVG
 * generated fresh on every request from real, current data, not a static
 * image someone uploads and forgets to update.
 *
 * Unauthenticated and keyed only by the log_id (the opaque public identifier
 * from lib/transparency.ts — never org_id), so embedding this badge in a
 * README or trust page reveals nothing beyond what GET /api/transparency
 * already publishes: "this workspace has sealed N checkpoints."
 *
 * Deliberately does NOT render a "chain verified ✓" claim — see
 * logSummary()'s own comment for why that would require re-deriving the
 * whole global feed, not something to redo on every badge fetch. This shows
 * only what a plain read proves: a count and a recency, both true by
 * construction. The badge links through to the real feed for the actual
 * cryptographic check.
 *
 *   GET /api/badge/rbl_xxx.svg   → embeddable badge
 */
import { NextRequest, NextResponse } from "next/server";
import { logSummary } from "@/lib/transparency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABEL_BG = "#1a1a1a";
const OK_BG = "#10b981"; // --emerald
const EMPTY_BG = "#6b7280"; // neutral gray — not a red/error state, just "nothing sealed yet"

// Shields.io-style approximate character width for a system-ui-ish sans font
// at 11px — precise glyph metrics aren't available server-side without a
// canvas/font-shaping library, and an approximate width that slightly
// over-pads reads better than a naive monospace guess that clips real text.
function textWidth(s: string): number {
  return Math.round(s.length * 6.6 + 10);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function badgeSvg(label: string, message: string, color: string): string {
  const labelW = textWidth(label);
  const msgW = textWidth(message);
  const w = labelW + msgW;
  const h = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
    <stop offset="1" stop-opacity=".08"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${h}" fill="${LABEL_BG}"/>
    <rect x="${labelW}" width="${msgW}" height="${h}" fill="${color}"/>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="14">${label}</text>
    <text x="${labelW + msgW / 2}" y="14">${message}</text>
  </g>
</svg>`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ logId: string }> }) {
  const { logId: raw } = await params;
  const logId = raw.replace(/\.svg$/i, "");

  // Same shape as any other log_id in this system — reject anything that
  // isn't, rather than let an arbitrary string reach the query.
  if (!/^rbl_[a-f0-9]{24}$/.test(logId)) {
    return new NextResponse(badgeSvg("runback", "invalid id", EMPTY_BG), {
      status: 400,
      headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
    });
  }

  const summary = await logSummary(logId).catch(() => ({ count: 0, latest: null }));

  const svg = summary.count > 0 && summary.latest
    ? badgeSvg("runback", `${summary.count.toLocaleString()} sealed · ${relativeTime(summary.latest.published_at)}`, OK_BG)
    : badgeSvg("runback", "no checkpoints yet", EMPTY_BG);

  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml",
      // Short cache, same reasoning as GET /api/transparency: a badge that's
      // stale for long defeats the point of it being live.
      "cache-control": "public, max-age=300",
    },
  });
}
