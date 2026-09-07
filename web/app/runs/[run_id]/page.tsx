import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/runs";
import { showcaseOrgId } from "@/lib/demoMode";
import { cassetteDigestFromEvents } from "@runback/replay";
import DebuggerShell from "@/components/debugger/DebuggerShell";
import { pageMetadata } from "@/lib/seo";

// Same reasoning as /runs: showcase-org data, not session-specific, so a
// short revalidate window means a transient DB blip doesn't serve a broken
// page to whoever hits it in that exact instant.
export const revalidate = 60;

/**
 * Name the run in the tab and in link previews.
 *
 * Without this the page inherited the site-wide title, so every run pasted into
 * Slack or attached to a Jira ticket rendered as "Runback — Deploy AI agents you
 * can prove are safe". Incident links are meant to be shared; identical titles
 * make a list of them useless.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id } = await params;
  const showcaseOrg = await showcaseOrgId();
  const data = showcaseOrg ? await getRun(run_id, showcaseOrg).catch(() => null) : null;
  const name = data?.run?.name;
  return pageMetadata({
    path: `/runs/${run_id}`,
    title: name ? `${name} · run ${run_id} — Runback` : `Run ${run_id} — Runback`,
    description: name
      ? `Captured run of ${name}: every model call, tool call and policy decision, replayable from the exact context.`
      : "A captured agent run — every model call, tool call and policy decision.",
    // A single run is not an index target; it is a link people share.
    robots: { index: false, follow: true },
  });
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id } = await params;

  // Scoped to the demo workspace, exactly like the /runs list beside it.
  //
  // This page called getRun(run_id) with no org. getRun applies `.eq("org_id")`
  // only when an org is passed, so that was an unscoped read: ANY tenant's run
  // was served to anonymous visitors by id, full trace — prompts, tool inputs,
  // tool outputs. The list page was fixed for this and the detail page was not,
  // and ids are not the protection they look like: /api/quickstart mints
  // "quickstart-$(date +%s)", roughly 86,400 candidates per day of scanning, so
  // every new customer's first action left a guessable public record of itself.
  const showcaseOrg = await showcaseOrgId();

  let data: Awaited<ReturnType<typeof getRun>> = null;
  let dbError = false;
  if (showcaseOrg) {
    try {
      data = await getRun(run_id, showcaseOrg);
    } catch {
      dbError = true;
    }
  }

  if (dbError) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "4rem 1.5rem" }}>
        <Link href="/runs" className="mono" style={{ fontSize: "0.8rem" }}>
          ← Runs
        </Link>
        <p className="empty" style={{ marginTop: "1rem" }}>
          Could not reach the database. Check Supabase env vars.
        </p>
      </main>
    );
  }

  if (!data) notFound();

  // Server-side (node crypto): the run's deterministic oracle-stream digest.
  const cassette = cassetteDigestFromEvents(data.events);

  return (
    <DebuggerShell run={data.run} events={data.events} cassetteDigest={cassette.digest} />
  );
}
