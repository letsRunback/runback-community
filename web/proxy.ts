import { NextRequest, NextResponse } from "next/server";
import { execToken, EXEC_COOKIE } from "@/lib/execGate";
import { verifyLicense } from "@/lib/license";

// verifyLicense() uses Node's synchronous crypto.verify (Ed25519), which needs
// the Node runtime. Under the old middleware.ts convention that required an
// explicit `export const runtime = "nodejs"`; proxy.ts always runs on Node, and
// Next now rejects the export outright.

// Two gates share this one proxy (Next.js allows only one; this file was
// middleware.ts until Next 16 deprecated that convention in favour of proxy.ts):
//   1. the private exec deck (unchanged from before)
//   2. marketing routes, in a LICENSED self-host deployment only
//
// Matcher is an ALLOWLIST-style exclusion, not a denylist of marketing pages —
// a security-relevant gate should fail toward "redirect too much" if a future
// page is forgotten, never toward "silently stay exposed". Excluded (must
// always be reachable, air-gapped or not): the app itself, the API, auth
// flows, the public audit-verify page a downloaded record links to, and
// static assets, and the technical reference pages (/docs, /spec).
// Static/agent-facing assets are excluded alongside the pages: they are not
// marketing, and redirecting them to /login broke RSS autodiscovery, the PWA
// manifest, the llms.txt agent index, and OG image generation on any
// self-hosted deployment.
// Must be a single static literal — Next parses this at build time, so string
// concatenation or any computed value fails the build.
//
// Each alternative is anchored with a trailing "/" or "$". Without that they
// were bare prefixes, so a future top-level route beginning with any of these
// letters — /applications, /authors, /specs — would silently bypass the
// self-host marketing gate. No route does today; the anchoring is what keeps
// that true. web/__tests__/proxyMatcher.test.ts pins the behaviour.
export const config = {
  matcher: ["/((?!_next/|api/|app/|app$|login/|login$|auth/|verify/|verify$|docs/|docs$|spec/|spec$|how-it-works$|sample-cassette\\.json$|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|icon\\.svg$|feed\\.xml$|llms\\.txt$|manifest\\.webmanifest$|opengraph-image|\\.well-known/).*)"],
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Gate 2 first: ANY self-hosted deployment hides ALL marketing routes,
  //    including the exec deck below — a bank running this air-gapped has no
  //    use for /pricing, /contact, or an investor deck, licensed or not.
  //    RUNBACK_SELF_HOSTED is set unconditionally by docker-compose.yml and
  //    never set on hosted runback.dev (Vercel), so it's the signal that
  //    distinguishes "self-host, no license yet" from "hosted SaaS" — those
  //    two cases are otherwise identical (both have RUNBACK_LICENSE unset).
  //    A valid RUNBACK_LICENSE also gates this, for defense in depth if
  //    RUNBACK_SELF_HOSTED were ever unset by mistake.
  const license = verifyLicense(process.env.RUNBACK_LICENSE);
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  if (license || selfHosted) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ── Gate 1: the private exec deck (unchanged) ──
  if (pathname === "/exec.html" || pathname === "/exec") {
    const pw = process.env.EXEC_PASSWORD;
    // Fail-open if no password is configured, so the gate can never lock everyone
    // out before the env var is set. Once EXEC_PASSWORD exists, the deck is private.
    if (!pw) return NextResponse.next();

    const cookie = req.cookies.get(EXEC_COOKIE)?.value;
    if (cookie && cookie === (await execToken(pw))) return NextResponse.next();

    const unlockUrl = req.nextUrl.clone();
    unlockUrl.pathname = "/exec-unlock";
    unlockUrl.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(unlockUrl);
  }

  return NextResponse.next();
}
