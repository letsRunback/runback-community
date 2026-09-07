import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listVersions } from "@/lib/prompts/prompts";
import { listLabels } from "@/lib/prompts/labels";
import MoveLabelButton from "./MoveLabelButton";

export const dynamic = "force-dynamic";

export default async function PromptDetail({ params }: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const session = await requireSession();

  const [versions, labels] = await Promise.all([listVersions(session.orgId, name), listLabels(session.orgId, name)]);
  if (versions.length === 0) notFound();

  const labelsByVersion = new Map<number, string[]>();
  for (const l of labels) labelsByVersion.set(l.version, [...(labelsByVersion.get(l.version) ?? []), l.label]);

  return (
    <div className="apprun">
      <Link href="/app/prompts" className="apprun-back mono">← Prompts</Link>
      <div className="appc-head">
        <h1 className="appc-h1">{name}</h1>
        <p className="appc-sub">
          {versions.length} version{versions.length === 1 ? "" : "s"} · model: <span className="mono">{versions[0].model.model_id}</span>
        </p>
      </div>

      <div className="eval-top">
        <Link href={`/app/prompts/${encodeURIComponent(name)}/playground?version=${versions[0].version}`} className="btn-line">
          Test in playground →
        </Link>
      </div>

      <h2 className="md-section-title">Labels</h2>
      <div className="table-wrap">
        <table className="appc-table">
          <thead><tr><th>Label</th><th>Version</th><th>Move to</th></tr></thead>
          <tbody>
            {(["production", "staging", ...labels.map((l) => l.label).filter((l) => l !== "production" && l !== "staging" && l !== "latest")]
              .filter((label, i, arr) => arr.indexOf(label) === i))
              .map((label) => {
                const current = labels.find((l) => l.label === label);
                return (
                  <tr key={label}>
                    <td className="mono">{label}</td>
                    <td className="mono appc-dim">{current ? `v${current.version}` : "— not set"}</td>
                    <td><MoveLabelButton name={name} label={label} versions={versions.map((v) => v.version)} current={current?.version ?? null} /></td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <h2 className="md-section-title">Version history</h2>
      <ul className="eval-results">
        {versions.map((v) => (
          <li key={v.id} className="eval-row">
            <div className="eval-row-top">
              <span className="eval-row-label mono">v{v.version}</span>
              {(labelsByVersion.get(v.version) ?? []).map((l) => (
                <span key={l} className="pill pill-muted">{l}</span>
              ))}
              <span className="mono appc-dim eval-latency">{new Date(v.created_at).toLocaleString()}</span>
            </div>
            {v.commit_message && <div className="eval-row-out mono">{v.commit_message}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
