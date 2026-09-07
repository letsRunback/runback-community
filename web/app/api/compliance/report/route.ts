import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { generateComplianceReport, illustrativeComplianceReport, cacheReport } from "@/lib/compliance";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // app/compliance/page.tsx renders the Download link unconditionally under
  // this same demo check; this route must match it or the link 403s.
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "compliance"));
  if (!allowed) return NextResponse.json({ error: "Enterprise feature" }, { status: 403 });

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const rawStart = url.searchParams.get("start") ?? thirtyAgo;
  const rawEnd   = url.searchParams.get("end")   ?? today;
  if (!dateRe.test(rawStart) || !dateRe.test(rawEnd) || isNaN(Date.parse(rawStart)) || isNaN(Date.parse(rawEnd)))
    return NextResponse.json({ error: "start and end must be valid YYYY-MM-DD dates." }, { status: 400 });
  const diffDays = (Date.parse(rawEnd) - Date.parse(rawStart)) / 86400_000;
  if (diffDays < 0 || diffDays > 1095)
    return NextResponse.json({ error: "Date range must be between 0 and 1095 days." }, { status: 400 });
  const start = rawStart;
  const end   = rawEnd;

  // The showcase demo account is unlocked (no 403) but must download the same
  // illustrative fixture the page shows it — never its own real seeded
  // numbers as if they were a genuine evidence package.
  if (demo) {
    return NextResponse.json(illustrativeComplianceReport(start, end, new Date().toISOString()));
  }

  const report = await generateComplianceReport(session.orgId, start, end, demo);
  await cacheReport(session.orgId, report, session.userId).catch(() => {});
  return NextResponse.json(report);
}
