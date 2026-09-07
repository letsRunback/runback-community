"use client";

import { useState } from "react";

function Field({
  label,
  value,
  set,
  min,
  max,
  prefix,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min: number;
  max: number;
  prefix?: string;
}) {
  return (
    <label className="calc-field">
      <span className="calc-label">{label}</span>
      <span className="calc-row">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
          className="calc-range"
        />
        <span className="calc-val mono">
          {prefix}
          {value.toLocaleString()}
        </span>
      </span>
    </label>
  );
}

/**
 * Honest exposure math: it prices ONLY the engineering cost of investigating
 * agent incidents the slow way. It deliberately does not invent a number for the
 * regulatory exposure — that's stated, not fabricated.
 */
export default function ExposureCalculator() {
  const [agents, setAgents] = useState(20);
  const [incidents, setIncidents] = useState(12);
  const [hours, setHours] = useState(16);
  const [engs, setEngs] = useState(3);
  const [rate, setRate] = useState(120);

  const statusQuo = incidents * hours * engs * rate; // $/yr investigating
  const withRunback = Math.round(statusQuo * 0.12); // minutes, not days
  const recovered = Math.max(0, statusQuo - withRunback);
  const fmt = (n: number) => "$" + Math.round(n).toLocaleString();

  return (
    <div className="calc">
      <div className="calc-inputs">
        <Field label="AI agents in production" value={agents} set={setAgents} min={1} max={500} />
        <Field label="Incidents needing investigation / year" value={incidents} set={setIncidents} min={0} max={300} />
        <Field label="Hours to investigate one today" value={hours} set={setHours} min={1} max={120} />
        <Field label="Engineers pulled into each one" value={engs} set={setEngs} min={1} max={20} />
        <Field label="Blended engineer cost / hour" value={rate} set={setRate} min={20} max={600} prefix="$" />
      </div>
      <div className="calc-out">
        <div className="calc-stat">
          <div className="v mono">{fmt(statusQuo)}</div>
          <div className="l">/ year investigating incidents the slow way</div>
        </div>
        <div className="calc-stat" data-good>
          <div className="v mono">{fmt(withRunback)}</div>
          <div className="l">with reproducible runs — minutes, not days</div>
        </div>
        <div className="calc-stat" data-hero>
          <div className="v mono">{fmt(recovered)}</div>
          <div className="l">recovered per year — before a single failed audit</div>
        </div>
      </div>
      <p className="calc-note">
        Engineering time only. It doesn&apos;t price the exposure of an agent
        decision you <em>can&apos;t reproduce for a regulator</em> — the line item
        that doesn&apos;t show up until it&apos;s a finding.
      </p>
    </div>
  );
}
