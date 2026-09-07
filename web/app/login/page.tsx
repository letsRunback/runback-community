import AuthHeader from "@/components/site/AuthHeader";
import Footer from "@/components/site/Footer";
import LoginForm from "./LoginForm";
import { getSession } from "@/lib/auth";
import { SHOWCASE, isDemoEmail } from "@/lib/demoMode";
import { pageMetadata } from "@/lib/seo";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ path: "/login", title: "Sign in" });

export default async function Login() {
  const session = await getSession().catch(() => null);
  // A real signed-in user clicking "Log in" again just wants back into their
  // workspace — skip straight there, unchanged from before.
  //
  // A DEMO session is different: the header's "Log in" link previously redirected
  // here unconditionally whenever any session existed, so a visitor who'd
  // clicked "Explore the live demo" earlier — or simply still had that cookie
  // from a prior visit — got silently bounced into the shared demo dashboard
  // the moment they clicked "Log in", with no login form ever shown and no
  // indication they were still in the demo, not their own account. Show the
  // real form instead, with an explicit way to leave the demo first.
  if (session && !isDemoEmail(session.email)) redirect("/app");
  const inDemo = !!session;
  // See docs/page.tsx: RUNBACK_SELF_HOSTED is what makes every other
  // marketing link in Header/Footer a dead end (proxy.ts redirects it back
  // to /login), so this page — which self-hosted users actually land on —
  // strips those links instead of rendering a footer full of loops.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;

  return (
    <>
      <AuthHeader selfHosted={selfHosted} />
      <main className="auth-page">
        <div className="auth-card">
          <span className="mk-eyebrow">Sign in</span>
          <h1 className="auth-h1">Sign in to your workspace.</h1>
          <p className="auth-lead">Passwordless — the same link creates your workspace if you&apos;re new.</p>
          {inDemo && (
            <div className="auth-notice">
              <span>You&apos;re browsing the shared public demo — sign in below for your own, or</span>
              <form action="/api/auth/logout" method="post">
                <input type="hidden" name="next" value="/login" />
                <button type="submit" className="link-btn">leave the demo</button>
              </form>
            </div>
          )}
          <LoginForm showcaseEnabled={SHOWCASE} />
        </div>
      </main>
      <Footer selfHosted={selfHosted} minimal />
    </>
  );
}
