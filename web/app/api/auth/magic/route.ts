import { NextRequest, NextResponse } from "next/server";
import { isHostedService } from "@/lib/deployment";
import { issueMagicLink } from "@/lib/auth";
import { sendMagicLink } from "@/lib/email";
import { classifyEmail } from "@/lib/leads";
import { rateLimitFailClosed, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const { valid } = classifyEmail(email);
  if (!valid) return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 422 });

  // Rate limit: 5 magic-link requests per 10 minutes per IP and per email.
  const ip = clientIp(req);
  const [ipResult, emailResult] = await Promise.all([
    rateLimitFailClosed(`magic-ip:${ip}`, 5, 10 * 60 * 1000),
    rateLimitFailClosed(`magic-email:${email}`, 5, 10 * 60 * 1000),
  ]);
  if (!ipResult.ok || !emailResult.ok) {
    const retryAfter = Math.max(ipResult.retryAfter, emailResult.retryAfter);
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const link = await issueMagicLink(email, { baseUrl: base });
  const sent = await sendMagicLink(email, link);
  // Never reveal whether the email exists; always report success to the UI.
  if (!sent) {
    console.error("[auth] magic link email failed to send to", email);

    // On a self-hosted deployment with no email provider configured, this was
    // an unrecoverable dead end: the magic link is the only non-Enterprise way
    // in, the send silently failed, the API still answered {ok:true}, and the
    // link existed only in a variable. A fresh install could not be logged into
    // at all — the first thing an evaluator tries.
    //
    // Printing it to the server log is safe here and nowhere else: on a
    // self-host the operator reading that log already owns the database. The
    // guard is isHostedService(), not an env flag, so this can never be enabled
    // on the multi-tenant service, where the log is not the user's to read.
    if (!isHostedService()) {
      console.warn(
        `\n[auth] No email provider is configured (set RESEND_API_KEY to send these).\n` +
        `[auth] Sign-in link for ${email}:\n\n    ${link}\n`
      );
    }
  }
  return NextResponse.json({ ok: true });
}
