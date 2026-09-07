"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number; children?: NavItem[] };
export type NavSection = { label: string; tone?: "blue" | "violet" | "amber" | "emerald"; items: NavItem[] };

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

/** Does this section contain the current page? */
function sectionActive(section: NavSection, pathname: string): boolean {
  return section.items.some(
    (i) => isActive(pathname, i.href) || i.children?.some((c) => isActive(pathname, c.href))
  );
}

/**
 * A parent that is itself a destination.
 *
 * These used to repeat themselves as their own first child — "Evals › Evals",
 * "Models › Models", "Policies › Policies" — which is where five of the
 * sidebar's twenty-four rows came from. The parent is now the link and the
 * chevron is a separate control, so a click does one obvious thing and the
 * duplicate row is gone.
 */
function NavParent({ item, pathname }: { item: NavItem; pathname: string }) {
  const childActive = item.children!.some((c) => isActive(pathname, c.href));
  // Exact match, not the shared prefix-based isActive() — that would also be
  // true on every child route (e.g. "/app/models/diff" starts with
  // "/app/models"), marking both the parent row AND the actual child row
  // aria-current="page" at once. The parent is "current" only on its own
  // overview page.
  const selfActive = pathname === item.href;

  // Open state is DERIVED, not synced: being on this branch opens it. A manual
  // toggle is an override tagged with the route it was made on, so navigating
  // away invalidates it automatically. Deriving during render avoids the
  // set-state-in-effect cascade that syncing would introduce.
  const [override, setOverride] = useState<{ open: boolean; at: string } | null>(null);
  const open = override && override.at === pathname ? override.open : childActive || selfActive;
  const setOpen = (next: boolean) => setOverride({ open: next, at: pathname });

  const badge = item.children!.reduce((s, c) => s + (c.badge ?? 0), 0) || undefined;

  return (
    <div className="appsh-nav-parent">
      <div className="appsh-nav-parent-row" data-active={selfActive || undefined}>
        <Link href={item.href} aria-current={selfActive ? "page" : undefined}>
          {item.label}
          {badge ? <span className="appsh-nav-badge">{badge}</span> : null}
        </Link>
        <button
          type="button"
          className="appsh-nav-toggle"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${item.label}`}
          onClick={() => setOpen(!open)}
        >
          <span className={`appsh-nav-chevron${open ? " open" : ""}`} aria-hidden>›</span>
        </button>
      </div>
      {open && (
        <div className="appsh-nav-children">
          {item.children!.map((c) => (
            <Link key={c.href} href={c.href} aria-current={isActive(pathname, c.href) ? "page" : undefined}>
              {c.label}
              {c.badge ? <span className="appsh-nav-badge">{c.badge}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Accordion sidebar.
 *
 * The nav was twenty-four permanent rows across six groups — 1,311px tall in a
 * 900px viewport, so Team, Settings and Sign out sat permanently below a fold
 * with no scroll cue. Now only the group containing the current page is open,
 * so at rest the sidebar is five headings plus wherever you actually are.
 * Nothing moved and nothing was removed: every destination is still at most two
 * clicks away, and the four-phase story (Observe → Replay → Gate → Audit) reads
 * far better as five headings than as twenty-four flat links.
 *
 * A collapsed group still shows the sum of its badges, so a pending approval or
 * an open incident can never hide behind a closed section.
 */
export default function NavLinks({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const activeLabel = sections.find((s) => s.label && sectionActive(s, pathname))?.label ?? null;

  // The group containing the current page is open by default. A click overrides
  // that for as long as you stay on this route; navigating re-derives.
  const [override, setOverride] = useState<{ label: string | null; at: string } | null>(null);
  const openLabel = override && override.at === pathname ? override.label : activeLabel;

  return (
    <nav className="appsh-nav">
      {sections.map((section) => {
        const key = section.label || "top";

        // The conditional "Get started" row has no label and is a single item —
        // collapsing it would hide the onboarding nudge it exists to give.
        if (!section.label) {
          return (
            <div key={key} className="appsh-nav-section-group" data-tone={section.tone}>
              {section.items.map((n) => (
                <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
                  {n.label}
                  {n.badge ? <span className="appsh-nav-badge">{n.badge}</span> : null}
                </Link>
              ))}
            </div>
          );
        }

        const open = openLabel === section.label;
        const groupBadge =
          section.items.reduce(
            (s, i) => s + (i.badge ?? 0) + (i.children?.reduce((t, c) => t + (c.badge ?? 0), 0) ?? 0),
            0
          ) || undefined;

        return (
          <div key={key} className="appsh-nav-section-group" data-tone={section.tone} data-open={open || undefined}>
            <button
              type="button"
              className="appsh-nav-section"
              aria-expanded={open}
              onClick={() => setOverride({ label: open ? null : section.label, at: pathname })}
            >
              <span>{section.label}</span>
              <span className="appsh-nav-section-right">
                {!open && groupBadge ? <span className="appsh-nav-badge">{groupBadge}</span> : null}
                <span className={`appsh-nav-chevron${open ? " open" : ""}`} aria-hidden>›</span>
              </span>
            </button>
            {open && (
              <div className="appsh-nav-section-items">
                {section.items.map((n) =>
                  n.children ? (
                    <NavParent key={n.href} item={n} pathname={pathname} />
                  ) : (
                    <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
                      {n.label}
                      {n.badge ? <span className="appsh-nav-badge">{n.badge}</span> : null}
                    </Link>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
