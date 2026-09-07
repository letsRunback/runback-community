import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listVersions } from "@/lib/prompts/prompts";
import PlaygroundPanel from "./PlaygroundPanel";

export const dynamic = "force-dynamic";

export default async function PromptPlayground({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const { version: versionParam } = await searchParams;
  const session = await requireSession();

  const versions = await listVersions(session.orgId, name);
  if (versions.length === 0) notFound();
  const version = versions.find((v) => v.version === Number(versionParam)) ?? versions[0];

  return (
    <div className="apprun">
      <Link href={`/app/prompts/${encodeURIComponent(name)}`} className="apprun-back mono">← {name}</Link>
      <div className="appc-head">
        <h1 className="appc-h1">Playground · {name} v{version.version}</h1>
        <p className="appc-sub">Fill in the variables and see what this version actually produces — optionally against other models side by side.</p>
      </div>
      <PlaygroundPanel template={version.template} variables={version.variables} model={version.model} params={version.params} />
    </div>
  );
}
