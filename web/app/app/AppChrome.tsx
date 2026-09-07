"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import StageMap from "./StageMap";

/**
 * The app shell, with a real mobile navigation.
 *
 * Below ~900px there was no navigation design at all: the 232px sidebar column
 * simply reflowed above the content. Measured on a 390px viewport it rendered
 * 491px wide inside a 390px window, so nine of seventeen nav rows — Policies,
 * Models, Approvals, Compliance, Ledger, Regulatory among them — were clipped
 * off the right edge and unreachable, with no hamburger, no drawer and no
 * scroll affordance. The page <h1> started at y=457, below the fold on a phone.
 *
 * Now: a fixed top bar with a menu button, and the sidebar as an off-canvas
 * drawer. The sidebar markup is unchanged and still server-rendered — it is
 * passed through as `sidebar` — so this component owns only the open/closed
 * state and the things that state implies (route changes close it, Escape
 * closes it, background scroll locks while it is open).
 */
export default function AppChrome({
  sidebar,
  brand,
  orgName,
  children,
}: {
  sidebar: React.ReactNode;
  brand: React.ReactNode;
  orgName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Derived, not synced. The drawer is open only while the route it was opened
  // on is still the current one, so navigating closes it without an effect that
  // sets state on every route change (and without the render cascade that
  // causes). Never leave a drawer covering the page the user just asked for.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    // setOpenedAt, not setOpen: the state setter is stable across renders, so the
    // effect needs no dependency on a function rebuilt every render.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedAt(null);
    };
    // Lock background scroll so the page behind does not move under the drawer.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="appsh" data-drawer={open || undefined}>
      {/* Mobile only — hidden at desktop widths where the sidebar is permanent. */}
      <header className="appsh-topbar">
        <button
          type="button"
          className="appsh-menu-btn"
          aria-expanded={open}
          aria-controls="app-sidebar"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
        >
          <span className="appsh-menu-icon" aria-hidden>
            <span /><span /><span />
          </span>
        </button>
        <div className="appsh-topbar-brand">{brand}</div>
        <span className="appsh-topbar-org mono">{orgName}</span>
      </header>

      <aside className="appsh-side" id="app-sidebar" aria-hidden={undefined}>
        {sidebar}
      </aside>

      {/* Click-away. Inert at desktop widths (display:none), so it can never
          intercept clicks on a layout that has no drawer. */}
      <button
        type="button"
        className="appsh-scrim"
        tabIndex={-1}
        aria-hidden
        onClick={() => setOpen(false)}
      />

      <main className="appsh-main">
        <StageMap />
        {children}
      </main>
    </div>
  );
}
