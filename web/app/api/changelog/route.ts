import { NextResponse } from "next/server";
import { changelogEntries } from "@/lib/changelog";

export const dynamic = "force-static";

/** Machine-readable release history, oldest-referencing-newest via prev_hash — same shape as GET /api/transparency, for anyone who wants to script a check instead of reading /changelog. */
export async function GET() {
  const entries = [...changelogEntries()].reverse(); // oldest first, matching the chain direction
  return NextResponse.json({ entries });
}
