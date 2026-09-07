import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { execToken, EXEC_COOKIE } from "@/lib/execGate";
import { rateLimitFailClosed, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Validate the deck password and, on success, set the gate cookie. */
export async function POST(req: NextRequest) {
  const rl = await rateLimitFailClosed(`exec-unlock:${clientIp(req)}`, 8, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts — give it a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const pw = process.env.EXEC_PASSWORD;
  if (!pw) return NextResponse.json({ ok: false, error: "Gate not configured." }, { status: 503 });

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const pwBuf = Buffer.from(pw);
  const inputBuf = Buffer.from(body.password ?? "");
  const match = body.password &&
    pwBuf.length === inputBuf.length &&
    timingSafeEqual(pwBuf, inputBuf);
  if (!match) {
    return NextResponse.json({ ok: false, error: "Wrong password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(EXEC_COOKIE, await execToken(pw), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
