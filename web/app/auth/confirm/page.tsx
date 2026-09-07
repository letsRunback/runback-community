import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import ConfirmButton from "./ConfirmButton";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ path: "/auth/confirm", title: "Confirm sign-in" });

export default async function Confirm({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  // See app/docs/page.tsx: /auth/confirm survives proxy.ts's self-host gate,
  // so it gets the trimmed self-host nav instead of a footer full of dead links.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  return (
    <>
      <Header selfHosted={selfHosted} />
      <main className="mk" style={{ paddingTop: "4rem", paddingBottom: "4rem", minHeight: "55vh" }}>
        <span className="mk-eyebrow">Almost in</span>
        <h1 style={{ fontSize: "clamp(1.8rem,3.4vw,2.4rem)", letterSpacing: "-0.04em", margin: "1rem 0 0.6rem" }}>
          Confirm your sign-in.
        </h1>
        {token ? (
          <>
            <p className="mk-lead" style={{ maxWidth: "48ch", marginBottom: "1.8rem" }}>
              Click to finish signing in. (This extra step stops email security scanners from
              using your link before you do.)
            </p>
            <ConfirmButton token={token} />
          </>
        ) : (
          <p className="mk-lead">
            This link is missing its token. <Link href="/login" style={{ color: "var(--brand)" }}>Request a new sign-in link →</Link>
          </p>
        )}
      </main>
      <Footer selfHosted={selfHosted} />
    </>
  );
}
