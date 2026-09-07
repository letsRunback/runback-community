/**
 * EU AI Act Art. 12 enforcement state.
 * Mandatory logging applies to Annex III (high-risk) AI systems from 2 August 2026.
 * All site copy that references this date should read from here so the framing
 * flips automatically on enforcement day — "mandatory from" becomes "now in force".
 */

const ENFORCEMENT_DATE = new Date("2026-08-02T00:00:00Z");

export function euAiActState(): {
  enforced: boolean;
  badge: { label: string; date: string; note: string };
  urgency: string;
  exposureLine: string;
} {
  const now = new Date();
  const enforced = now >= ENFORCEMENT_DATE;

  if (enforced) {
    return {
      enforced: true,
      badge: {
        label: "EU AI Act Art. 12",
        date: "in force",
        note: "mandatory logging — non-compliance means enforcement action",
      },
      urgency: "The EU AI Act requires high-risk systems to keep automatic event logs over their lifetime — enforceable since 2 August 2026. Non-compliance means enforcement action from national supervisory authorities.",
      exposureLine: "The EU AI Act requires high-risk systems to keep automatic event logs over their lifetime — enforceable since 2 August 2026.",
    };
  }

  return {
    enforced: false,
    badge: {
      label: "EU AI Act Art. 12",
      date: "2 August 2026",
      note: "mandatory logging — enforcement from this date",
    },
    urgency: "The EU AI Act requires high-risk systems to keep automatic event logs over their lifetime — enforceable from 2 August 2026. Non-compliance means enforcement action from national supervisory authorities.",
    exposureLine: "The EU AI Act requires high-risk systems to keep automatic event logs over their lifetime — enforceable from 2 August 2026.",
  };
}
