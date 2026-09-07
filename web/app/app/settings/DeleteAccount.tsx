"use client";

import { useState } from "react";

/**
 * GDPR Art.17 self-service erasure.
 *
 * /api/user/erase has been fully implemented — correct sole-member org cascade,
 * marketing-table PII cleanup, session invalidation — and completely unreachable:
 * no button, link, or form anywhere in the product called it. /privacy tells
 * users they can delete their data, so the only actual route to exercise that
 * right was emailing support and hoping someone ran it by hand.
 *
 * The confirmation phrase is required by the API, not decoration: it is what
 * stops a CSRF-shaped request from deleting an account on a stray click.
 */
const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function erase() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/user/erase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_PHRASE }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Never let a failed deletion look like a completed one — the user would
        // walk away believing their data is gone.
        setError(data.error || `Deletion failed (HTTP ${res.status}). Nothing has been deleted.`);
        setBusy(false);
        return;
      }
      // Session is destroyed server-side; a full reload lands on the public site.
      window.location.href = "/";
    } catch {
      setError("Network error — nothing has been deleted. Please try again.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <p className="settings-hint">
          Permanently delete your account and personal data. Orgs where you are the
          only member are deleted outright, along with their runs, events, and API
          keys. Orgs with other members stay intact — you are removed from them.
          This cannot be undone.
        </p>
        <button className="btn-line settings-danger-btn" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="settings-hint">
        This is permanent. Type <strong>{CONFIRM_PHRASE}</strong> to confirm.
      </p>
      <input
        className="settings-input mono"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder={CONFIRM_PHRASE}
        aria-label={`Type ${CONFIRM_PHRASE} to confirm account deletion`}
        autoComplete="off"
      />
      <div className="settings-danger-actions">
        <button
          className="btn-line settings-danger-btn"
          disabled={phrase !== CONFIRM_PHRASE || busy}
          onClick={erase}
        >
          {busy ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          className="btn-line"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setPhrase("");
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="gs-error">{error}</p>}
    </div>
  );
}
