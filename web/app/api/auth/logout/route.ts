import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await destroySession();
  // Optional same-origin-only redirect target (e.g. back to /login after
  // exiting a demo session) — defaults to "/" unchanged for every existing
  // caller. Only ever a relative path: "/foo", never "//evil.com" or an
  // absolute URL, so this can't be turned into an open redirect.
  const form = await req.formData().catch(() => null);
  const next = form?.get("next");
  const dest = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(dest, req.url), { status: 303 });
}
