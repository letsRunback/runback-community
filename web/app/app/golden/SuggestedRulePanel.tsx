"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * A drafted policy rule from an uncovered incident — read-only, copy-and-paste
 * into the policy editor. Deliberately not a one-click "activate" button: the
 * predicate blocks the tool unconditionally (see the note), so a human has to
 * actually look at it before it goes anywhere near enforcement.
 */
export default function SuggestedRulePanel({ note, ruleJson }: { note: string; ruleJson: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="golden-suggest">
      <div className="golden-suggest-h mono">Suggested rule — draft, not active</div>
      <p className="golden-suggest-note">{note}</p>
      <div className="golden-suggest-box">
        <pre className="golden-suggest-pre mono">{ruleJson}</pre>
        <button
          type="button"
          className="golden-suggest-copy mono"
          onClick={() => {
            navigator.clipboard?.writeText(ruleJson).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <Link href="/app/policies" className="golden-suggest-link mono">Paste into Policies to review →</Link>
    </div>
  );
}
