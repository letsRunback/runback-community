"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useReplayModels } from "@/lib/replay/useReplayModels";

/** Kicks off an eval over a dataset and navigates to its results when done.
 *
 *  `basePath` decides WHICH eval viewer to land on. This component is mounted
 *  from both the public /datasets/[id] page and the in-app /app/datasets/[id]
 *  page; it used to hardcode "/evals", so running an eval from inside the app
 *  dropped the user out of the app shell onto the public marketing-chrome
 *  viewer. Each caller now passes its own base.
 */
export default function RunEvalButton({
  datasetId,
  disabled,
  basePath = "/evals",
}: {
  datasetId: string;
  disabled?: boolean;
  basePath?: "/evals" | "/app/evals";
}) {
  const models = useReplayModels();
  const router = useRouter();
  const [modelId, setModelId] = useState("captured");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/evals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataset_id: datasetId,
          model_id: modelId === "captured" ? undefined : modelId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.eval_id) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
        setRunning(false);
        return;
      }
      router.push(`${basePath}/${data.eval_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
      <select
        className="replay-select"
        style={{ width: "auto", minWidth: 200 }}
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        disabled={running}
      >
        <option value="captured">Replay each item&apos;s captured model</option>
        {models.map((m) => (
          <option key={m} value={m}>
            Override with {m}
          </option>
        ))}
      </select>
      <button className="replay-btn" onClick={run} disabled={running || disabled}>
        {running ? "Running eval…" : "Run eval ▸"}
      </button>
      {error && (
        <span style={{ color: "var(--rose)", fontSize: "0.8rem" }}>{error}</span>
      )}
    </div>
  );
}
