"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLE = JSON.stringify([
  {
    id: "escalate-large-disputed",
    kind: "require",
    description: "Disputed refunds over $100 must be escalated, not auto-issued",
    when: { op: "and", all: [
      { op: "tool_arg", tool: "issue_refund", path: "amount", cmp: "gt", value: 100 },
      { op: "input_matches", pattern: "disputed" },
    ] },
    then: { op: "tool_called", tool: "escalate_to_human" },
  },
  { id: "no-error", kind: "assert", description: "The run must not error", pred: { op: "no_error" } },
], null, 2);

export default function PolicyEditor() {
  const [name, setName] = useState("");
  const [rules, setRules] = useState(EXAMPLE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sim, setSim] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);
  const router = useRouter();

  async function save() {
    setMsg(null);
    let parsed: unknown;
    try { parsed = JSON.parse(rules); } catch { setMsg({ ok: false, text: "Rules must be valid JSON." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, rules: parsed }) });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { setMsg({ ok: true, text: `Saved “${data.policy.name}” v${data.policy.version}.` }); setName(""); router.refresh(); }
      else setMsg({ ok: false, text: data.error || "Failed." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function simulate() {
    setMsg(null);
    setSim(null);
    let parsed: unknown;
    try { parsed = JSON.parse(rules); } catch { setMsg({ ok: false, text: "Rules must be valid JSON." }); return; }
    setSimLoading(true);
    try {
      const res = await fetch("/api/policies/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: parsed }) });
      const data = await res.json();
      if (data.ok) setSim(data.result);
      else setMsg({ ok: false, text: data.error || "Simulation failed." });
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setSimLoading(false); }
  }

  return (
    <div className="pol-editor">
      <div className="pol-field">
        <span>Policy name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Refund policy" />
      </div>
      <div className="pol-field">
        <span>Rules <em>(JSON — assert / require)</em> <button type="button" className="pol-link" onClick={() => setRules(EXAMPLE)}>load example</button></span>
        <textarea className="pol-rules mono" value={rules} onChange={(e) => setRules(e.target.value)} rows={16} spellCheck={false} />
        <details className="pol-syntax">
          <summary>Rule syntax reference →</summary>
          <div className="pol-syntax-body">
            <p>A rule is one of two shapes:</p>
            <dl className="pol-syntax-dl">
              <dt className="mono">kind: &quot;assert&quot;</dt>
              <dd>Fails the run if <code className="mono">pred</code> doesn&apos;t hold. Use for invariants like &quot;must not error.&quot;</dd>
              <dt className="mono">kind: &quot;require&quot;</dt>
              <dd>When <code className="mono">when</code> holds, <code className="mono">then</code> must also hold — otherwise it&apos;s blocked. Use for conditional guardrails.</dd>
            </dl>
            <p>A condition (<code className="mono">pred</code> / <code className="mono">when</code> / <code className="mono">then</code>) is one <code className="mono">op</code>:</p>
            <dl className="pol-syntax-dl">
              <dt className="mono">tool_called</dt><dd><code className="mono">{`{ tool }`}</code> — this tool was called.</dd>
              <dt className="mono">tool_arg</dt><dd><code className="mono">{`{ tool, path, cmp, value }`}</code> — a call argument compares against <code className="mono">value</code>. <code className="mono">cmp</code>: eq / ne / lt / lte / gt / gte.</dd>
              <dt className="mono">input_matches / output_matches</dt><dd><code className="mono">{`{ pattern, flags? }`}</code> — a regex against the run&apos;s input or output.</dd>
              <dt className="mono">finish_reason</dt><dd><code className="mono">{`{ equals }`}</code> — the model&apos;s finish reason.</dd>
              <dt className="mono">tool_call_count</dt><dd><code className="mono">{`{ cmp, value }`}</code> — how many tools were called.</dd>
              <dt className="mono">no_error</dt><dd>no arguments — the run didn&apos;t error.</dd>
              <dt className="mono">and / or / not</dt><dd>combine other conditions: <code className="mono">{`{ all: [...] } / { any: [...] } / { pred: ... }`}</code>.</dd>
            </dl>
          </div>
        </details>
      </div>
      <div className="pol-actions">
        <button className="btn-fill" onClick={simulate} disabled={simLoading}>{simLoading ? "Simulating…" : "Simulate against history →"}</button>
        <button className="btn-line" onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save policy version"}</button>
        {msg && <span className={msg.ok ? "team-ok" : "gs-error"}>{msg.text}</span>}
      </div>

      <details className="pol-enforce">
        <summary>Enforce this at runtime →</summary>
        <p className="pol-enforce-note">Pass the same rules to the SDK and they run as an in-process pre-hook — a violating action is blocked <em>before</em> it executes, and the block is recorded as re-runnable proof. No network in your agent&apos;s path.</p>
        <pre className="pol-enforce-code mono"><code>{`import { withDebugger } from "@runback/sdk";

const dbg = withDebugger(model, {
  runName: "support-agent",
  input: task,
  enforce: ${rules.trim().split("\n").map((l, i) => (i === 0 ? l : "  " + l)).join("\n")},
});
// A blocked tool returns { runback_blocked: true, rule, reason }
// so the agent can re-plan (e.g. escalate) instead of acting.`}</code></pre>
      </details>

      {sim && (
        <div className={`pol-sim ${sim.blocked > 0 ? "warn" : "ok"}`}>
          <div className="pol-sim-head">
            <strong>{sim.blocked > 0 ? `Would have blocked ${sim.blocked} of ${sim.blocked + sim.allowed} runs` : "Would have blocked nothing"}</strong>
            <span className="mono">{sim.total} examined · {sim.notApplicable} had no decision</span>
          </div>
          <p className="pol-sim-note">If this policy had been live, here&apos;s what it would have caught — before you enforce it. No model calls.</p>
          {sim.affected?.length > 0 && (
            <ul className="pol-sim-list">
              {sim.affected.slice(0, 12).map((a: { run_id: string; name: string | null; detail: string }) => (
                <li key={a.run_id}>
                  <a href={`/app/runs/${a.run_id}`} className="mono">{a.name || a.run_id}</a>
                  <span className="pol-sim-detail">{a.detail}</span>
                </li>
              ))}
              {sim.affected.length > 12 && <li className="pol-sim-more mono">+{sim.affected.length - 12} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
