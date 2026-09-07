"use client";

/**
 * Not everyone recognizes their own work in a bank's refund policy. Three
 * small pills, one InteractiveTrace underneath — a visitor picks the world
 * closest to theirs instead of being shown one universal story. Reuses the
 * existing chip visual language (.bisect-chip) rather than inventing a new
 * one, and InteractiveTrace exactly as built — no new trace-rendering code.
 */
import { useState } from "react";
import InteractiveTrace from "./InteractiveTrace";
import { GATE_SCENARIO, HEALTHCARE_SCENARIO, OPS_SCENARIO } from "./scenarios";
import type { TraceScenario } from "./InteractiveTrace";

const OPTIONS: { key: string; label: string; scenario: TraceScenario }[] = [
  { key: "finance", label: "Financial services", scenario: GATE_SCENARIO },
  { key: "health", label: "Healthcare & insurance", scenario: HEALTHCARE_SCENARIO },
  { key: "ops", label: "Internal ops & procurement", scenario: OPS_SCENARIO },
];

export default function ScenarioSwitcher() {
  const [selected, setSelected] = useState(0);
  return (
    <div>
      <div className="bisect-candidate-chips" style={{ marginBottom: "1rem" }}>
        {OPTIONS.map((opt, i) => (
          <button
            key={opt.key}
            type="button"
            className="bisect-chip"
            data-on={i === selected || undefined}
            onClick={() => setSelected(i)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <InteractiveTrace scenario={OPTIONS[selected].scenario} />
    </div>
  );
}
