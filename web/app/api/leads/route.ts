import { NextRequest, NextResponse } from "next/server";
import { captureLead } from "@/lib/leads";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Per-IP: 5 submissions per 10 minutes (prevents enumeration + spam)
  const ipRl = await rateLimit(`leads-ip:${clientIp(req)}`, 5, 600_000);
  if (!ipRl.ok) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: { "retry-after": String(ipRl.retryAfter) } });
  }

  let body: { email?: string; company?: string; useCase?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Per-email: 1 per 24 h (idempotent for the same address)
  const email = (body.email ?? "").toLowerCase().trim();
  if (email) {
    const emailRl = await rateLimit(`leads-email:${email}`, 1, 86_400_000);
    if (!emailRl.ok) {
      return NextResponse.json({ ok: false, error: "Already submitted." }, { status: 429 });
    }
  }

  const result = await captureLead({
    email: body.email ?? "",
    company: body.company,
    useCase: body.useCase,
    source: body.source ?? "get-started",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
