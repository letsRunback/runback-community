"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ConnectSnippet from "./ConnectSnippet";

export default function Onboarding({ canAdmin }: { canAdmin: boolean }) {
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);

  async function loadDemo() {
    setSeeding(true);
    const res = await fetch("/api/app/seed-demo", { method: "POST" });
    const data = await res.json();
    setSeeding(false);
    if (data.ok) router.push("/app/runs?welcome=1");
    else alert(data.error || "Failed to load sample data.");
  }

  return (
    <div className="onb">
      <div className="onb-hero">
        <span className="mk-eyebrow" data-tone="emerald">Welcome</span>
        <h2 className="onb-h">See Runback work in 30 seconds.</h2>
        <p className="onb-sub">Load a few sample agent runs — including a real policy breach you can replay step-by-step — and your control room fills in. Then connect your own agent.</p>
      </div>

      <div className="onb-grid">
        {/* Fast path: sample data */}
        <div className="onb-card onb-primary">
          <div className="onb-step mono">1 · Fastest</div>
          <h3>Load sample data</h3>
          <p>Populates your dashboard and a replayable failed run — no setup. Best way to feel the product first.</p>
          <button className="btn-fill" onClick={loadDemo} disabled={seeding}>
            {seeding ? "Loading…" : "Load sample data →"}
          </button>
        </div>

        {/* Real path: connect an agent */}
        <div className="onb-card">
          <div className="onb-step mono">2 · Your agent</div>
          <h3>Send your first real run</h3>
          <p>Grab a key and drop 3 lines into your agent — runs appear here live.</p>
          <ConnectSnippet canAdmin={canAdmin} />
        </div>
      </div>

      <p className="empty onb-foot" style={{ fontSize: "0.85rem" }}>
        Once you have runs, explore <strong>Runs → open one → Time-travel replay</strong> and the signed audit export.
        {" "}Need your API key later? <Link href="/app/settings" className="appc-link">Settings → API Key</Link>.
        {" "}Lost this screen? <Link href="/app/get-started" className="appc-link">Find it again →</Link>
      </p>
    </div>
  );
}
