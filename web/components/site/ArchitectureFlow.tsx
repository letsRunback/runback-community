"use client";

/**
 * Where Runback sits — logos flowing into "your agents," through Runback,
 * out to the three things it's actually for. Replaces a flat logo list with
 * the positioning the list alone couldn't carry: a layer, not a platform to
 * migrate onto.
 */
import { BrandLogo, type IconKey } from "./IntegrationLogos";

const TOP_LOGOS: IconKey[] = ["openai", "anthropic", "gemini", "meta", "langchain", "opentelemetry"];

const BRANCHES = [
  { k: "Replay", v: "Engineering" },
  { k: "Gate", v: "CI / CD" },
  { k: "Proof", v: "Governance" },
];

export default function ArchitectureFlow() {
  return (
    <div className="af-wrap">
      <div className="af-logos">
        {TOP_LOGOS.map((id) => (
          <BrandLogo key={id} id={id} size={20} withTint />
        ))}
      </div>
      <span className="af-arrow" aria-hidden>↓</span>
      <div className="af-agents-bar">Your agents</div>
      <span className="af-arrow" aria-hidden>↓</span>
      <div className="af-runback-box">RUNBACK</div>
      <span className="af-arrow" aria-hidden>↓</span>
      <div className="af-branches">
        {BRANCHES.map((b) => (
          <div className="af-branch" key={b.k}>
            <span className="af-branch-k mono">{b.k}</span>
            <span className="af-branch-v">{b.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
