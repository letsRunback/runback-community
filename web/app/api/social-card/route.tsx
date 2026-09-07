import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import type { ReactElement } from "react";

export const runtime = "edge";

/**
 * Dynamic LinkedIn/social cards — the scroll-stopping image each post ships with.
 *
 * The old posts attached raw product screenshots (dashboard.png, evals.png).
 * A screenshot of an unfamiliar dashboard is noise in a feed: no context, no
 * tension, nothing that reads in the half-second before a thumb keeps moving.
 *
 * This file has two layers. The CONTENT layer (Card, cardFor, the variant
 * pools) decides what a post says — eyebrow, headline, kicker, fix line,
 * verdict, accent color — seeded from the signal so the same post always
 * reproduces the same content. The LAYOUT layer (15 functions in LAYOUTS)
 * decides how that content is arranged on the canvas. They're independent:
 * giving the content real variety fixed HALF the "every post looks the
 * same" problem, because all of it still poured into one fixed skeleton —
 * terminal on one side, headline on the other, forever. Real distinctness
 * needs both layers varying, which is why layout selection uses its own
 * seed stream, decorrelated from the content choices above it.
 *
 * Every layout is grounded in something Runback actually does — a redaction
 * bar, a hash chain, a signed receipt, a verify command — not an arbitrary
 * rearrangement of boxes for its own sake.
 *
 *   /api/social-card?type=regulatory&headline=EU%20AI%20Act%20Article%2012%20is%20now%20enforceable
 *   /api/social-card?type=fleet_weekly&stat=12,400&cause=policy%20deviation
 *   /api/social-card?type=model_release&model=Claude%20Opus%205
 *   /api/social-card?type=incident&headline=Another%20agent%20shipped%20a%20wrong%20refund
 */

const BG = "#0a0b0d";
const INK = "#f2f0ea";
const MUTE = "#8f8fa8";
const DIM = "#545470";
const AMBER = "#e8873d";
const TEAL = "#3ecfb8";
const GREEN = "#4ade80";
const ROSE = "#fb7185";
const VIOLET = "#7c5cfc";
const BLUE = "#4f9cf9";
const EMERALD = "#10b981";

/** mulberry32 — small, dependency-free seeded PRNG. Deterministic per seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** djb2 — stable, no crypto import needed, only used for a display suffix. */
export function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

/* ── Content layer: what a card says ─────────────────────────────────────── */

interface Card {
  eyebrow: string;
  eyebrowColor: string;
  headline: string[];    // rendered as stacked lines (fixed hand-written copy)
  headlineFontSize?: number;
  /**
   * A real, variable-length headline (an RSS title, not our copy) plus the
   * short fixed reaction line underneath it. Kept separate from `headline`
   * because the two need different treatment: `headline` is pre-written
   * short copy split across exactly two lines by hand; a real title has to
   * wrap naturally at whatever length it actually is.
   */
  realHeadline?: string;
  kicker?: string;
  fix: string;
  hero: "valid" | "invalid" | "stat";
  statValue?: string;
  statLabel?: string;
  file?: string;          // the filename in the terminal's npx command — defaults to "record.json"
}

/**
 * Ellipsis-truncates `text` as a last-resort safety cap — not the primary
 * line-break mechanism. Real headlines wrap naturally across multiple lines
 * at a length-appropriate font size (see headlineFontSizeFor); this only
 * bites on the rare title long enough to still overflow that.
 */
function clipLine(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * A real RSS title can be 20 characters or 120. Rather than chop it to fit
 * one fixed size, scale the size down as it gets longer so it wraps to 2-3
 * lines instead of overflowing or needing truncation.
 */
function headlineFontSizeFor(text: string, base = 44): number {
  if (text.length <= 40) return base;
  if (text.length <= 65) return base - 8;
  return base - 14;
}

/**
 * Turns real post content into the filename shown in the terminal's npx
 * command — suffixed with a short hash of the FULL input (not just the
 * truncated slug) so two titles that happen to share their first couple of
 * words still produce visibly different filenames.
 */
function slugFile(text: string, maxWords = 2): string {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean).slice(0, maxWords);
  let base = words.join("-") || "record";
  if (base.length > 8) base = base.slice(0, 8);
  return `${base}-${djb2(text).toString(16).slice(0, 4)}.json`;
}

const EYEBROW_VARIANTS: Record<string, string[]> = {
  regulatory: ["EU AI ACT · ARTICLE 12 · IN FORCE", "ARTICLE 12 IS NOW LIVE", "LOGS ALONE AREN'T EVIDENCE", "ENFORCEABLE SINCE AUG 2026"],
  model_release: ["MODEL RELEASE", "NEW MODEL, SAME QUESTION", "BEFORE YOU UPGRADE", "DRIFT CHECK, NOT A GUESS"],
  incident: ["THE FAILURE CLASS THAT REPEATS", "ANOTHER UNPROVABLE INCIDENT", "NO RECORD, NO ANSWER", "SAME ROOT CAUSE, AGAIN"],
  fleet_weekly: ["THIS WEEK ACROSS THE FLEET", "WEEKLY LEDGER SNAPSHOT", "SEALED THIS WEEK", "THE WEEK IN VERIFIED RUNS"],
};

const KICKER_VARIANTS: Record<string, string[]> = {
  regulatory: ["Prove it — don't just log it.", "Logs that can be edited aren't evidence.", "Verifiable, not just recorded.", "An auditor checks it, not just you."],
  incident: ["Runback makes it provable.", "This is what an unprovable decision looks like.", "No record survives review — until now.", "The record it should have had."],
};

const FIX_VARIANTS: Record<string, string[]> = {
  regulatory: [
    "Runback seals every agent decision in a record an auditor checks without trusting you.",
    "Every decision is sealed the moment it happens — checkable by someone who doesn't trust you.",
    "A tamper-evident record replaces 'trust our logs' with 'check it yourself.'",
    "Sealed, signed, and independently verifiable — not just written down.",
  ],
  model_release: [
    "Replay 90 days of production decisions against it before you ship. Drift surfaces as regressions, not incidents.",
    "Runback replays your real decisions against the new model first — drift shows up as a diff, not a postmortem.",
    "Test it against 90 days of what your agents actually did, before it's live.",
    "Behavioural drift becomes a reviewable diff, not something you discover in production.",
  ],
  incident: [
    "A tamper-evident record of every input and decision — one that can't be reconstructed after the fact.",
    "Every input and decision sealed as it happens — nothing to reconstruct after the fact.",
    "The record exists before the incident does, not after someone asks for it.",
    "What the model saw and why it acted — captured, not inferred afterwards.",
  ],
  fleet_weekly: [
    "Every record independently checkable — no account, no Runback software.",
    "Hash-chained, independently verifiable, re-runnable against its original inputs.",
    "Checkable by anyone, with nothing installed but a terminal.",
    "Not a compliance checkbox — a system of record for what agents actually did.",
  ],
};

const MODEL_SECOND_LINE_VARIANTS = [
  "Will your agent still behave?",
  "Same behaviour, or a surprise?",
  "You'll find out before or after shipping.",
  "The question is when you find out, not if.",
];

const FLEET_HEADLINE_VARIANTS: [string, string][] = [
  ["agent decisions sealed", "in verifiable records."],
  ["decisions sealed,", "every one checkable."],
  ["records sealed", "this week alone."],
  ["agent decisions,", "none of them trust-based."],
];

/** Per-type accent pool — keeps the verdict's own red/green semantic intact while giving the card's brand accent real variety instead of one fixed hue per type. */
const ACCENT_POOL: Record<string, string[]> = {
  regulatory: [AMBER, TEAL],
  model_release: [TEAL, BLUE, VIOLET],
  incident: [ROSE, AMBER],
  fleet_weekly: [TEAL, EMERALD],
  default: [AMBER, TEAL],
};

export function cardFor(type: string, q: URLSearchParams, seed: number): Card {
  const rand = mulberry32(seed ^ 0x1a2b3c4d);
  const model = q.get("model") || "The new model";
  const stat = q.get("stat") || "—";
  const cause = q.get("cause") || "policy deviation";
  const headline = q.get("headline");
  const accentColor = pickFrom(rand, ACCENT_POOL[type] ?? ACCENT_POOL.default);

  switch (type) {
    case "regulatory":
      return headline
        ? {
            eyebrow: pickFrom(rand, EYEBROW_VARIANTS.regulatory),
            eyebrowColor: accentColor,
            headline: [],
            realHeadline: clipLine(headline, 110),
            headlineFontSize: headlineFontSizeFor(headline),
            kicker: pickFrom(rand, KICKER_VARIANTS.regulatory),
            fix: pickFrom(rand, FIX_VARIANTS.regulatory),
            hero: "valid",
            file: slugFile(headline),
          }
        : {
            eyebrow: pickFrom(rand, EYEBROW_VARIANTS.regulatory),
            eyebrowColor: accentColor,
            headline: ["Your logs can be edited.", "That isn't evidence."],
            fix: pickFrom(rand, FIX_VARIANTS.regulatory),
            hero: "valid",
          };
    case "model_release":
      return {
        eyebrow: pickFrom(rand, EYEBROW_VARIANTS.model_release),
        eyebrowColor: accentColor,
        headline: [`${model} is out.`, pickFrom(rand, MODEL_SECOND_LINE_VARIANTS)],
        fix: pickFrom(rand, FIX_VARIANTS.model_release),
        hero: "valid",
        file: q.get("model") ? slugFile(model, 2) : undefined,
      };
    case "incident":
      return headline
        ? {
            eyebrow: pickFrom(rand, EYEBROW_VARIANTS.incident),
            eyebrowColor: accentColor,
            headline: [],
            realHeadline: clipLine(headline, 110),
            headlineFontSize: headlineFontSizeFor(headline),
            kicker: pickFrom(rand, KICKER_VARIANTS.incident),
            fix: pickFrom(rand, FIX_VARIANTS.incident),
            hero: "invalid",
            file: slugFile(headline),
          }
        : {
            eyebrow: pickFrom(rand, EYEBROW_VARIANTS.incident),
            eyebrowColor: accentColor,
            headline: ["“We can't prove what", "the model actually saw.”"],
            fix: pickFrom(rand, FIX_VARIANTS.incident),
            hero: "invalid",
          };
    case "fleet_weekly": {
      const [l1, l2] = pickFrom(rand, FLEET_HEADLINE_VARIANTS);
      return {
        eyebrow: pickFrom(rand, EYEBROW_VARIANTS.fleet_weekly),
        eyebrowColor: accentColor,
        headline: [l1, l2],
        fix: `Top signal: ${cause}. ${pickFrom(rand, FIX_VARIANTS.fleet_weekly)}`,
        hero: "stat",
        statValue: stat,
        statLabel: "decisions sealed this week",
        file: q.get("cause") ? slugFile(`fleet ${cause}`) : undefined,
      };
    }
    default:
      return {
        eyebrow: "PROVE IT",
        eyebrowColor: accentColor,
        headline: ["Deploy AI agents", "you can prove are safe."],
        fix: "Tamper-evident audit records for AI agents. Verify one in your terminal.",
        hero: "valid",
      };
  }
}

/** The headline as plain text, whichever form the content layer produced. */
function headlineText(c: Card): string {
  return c.realHeadline ?? c.headline.join(" ");
}

function verdictWord(c: Card): "VALID" | "INVALID" {
  return c.hero === "invalid" ? "INVALID" : "VALID";
}
function verdictColor(c: Card): string {
  return c.hero === "invalid" ? ROSE : GREEN;
}

/* ── Shared primitives — reused across layouts ───────────────────────────── */

const GRADIENT_POSITIONS: { a: string; b: string }[] = [
  { a: "82% -12%", b: "4% 108%" },
  { a: "-10% -14%", b: "104% 106%" },
  { a: "50% -18%", b: "50% 118%" },
  { a: "110% 42%", b: "-10% 62%" },
  { a: "18% 112%", b: "92% -12%" },
  { a: "-12% 52%", b: "112% 48%" },
];
const ACCENT_PALETTE = [AMBER, TEAL, VIOLET, BLUE, EMERALD, ROSE];

/** The classic treatment: near-black, a two-blob gradient tracking the card's own accent, a faint grid. Used by layouts that want that texture; others go flatter or split on purpose. */
function gridBackground(seed: number, primary: string) {
  const rand = mulberry32(seed);
  const pos = GRADIENT_POSITIONS[Math.floor(rand() * GRADIENT_POSITIONS.length)];
  const secondary = ACCENT_PALETTE[Math.floor(rand() * ACCENT_PALETTE.length)];
  const grid = [48, 56, 64][Math.floor(rand() * 3)];
  const gridOpacity = [0.025, 0.035, 0.045][Math.floor(rand() * 3)];
  return {
    width: "100%", height: "100%", display: "flex", flexDirection: "column" as const,
    justifyContent: "space-between" as const, position: "relative" as const, background: BG,
    backgroundImage:
      `radial-gradient(900px 500px at ${pos.a}, ${hexToRgba(primary, 0.2)}, transparent), ` +
      `radial-gradient(760px 520px at ${pos.b}, ${hexToRgba(secondary, 0.16)}, transparent), ` +
      `linear-gradient(rgba(255,255,255,${gridOpacity}) 1px, transparent 1px), ` +
      `linear-gradient(90deg, rgba(255,255,255,${gridOpacity}) 1px, transparent 1px)`,
    backgroundSize: `100% 100%, 100% 100%, ${grid}px ${grid}px, ${grid}px ${grid}px`,
    padding: "64px 72px", color: INK,
  };
}

/** A flat, quieter ground for layouts where the composition itself (not a grid+glow backdrop) should carry the page — the seal, the gauge, the poster, the quote. */
function flatBackground(primary: string) {
  return {
    width: "100%", height: "100%", display: "flex", flexDirection: "column" as const,
    justifyContent: "space-between" as const, position: "relative" as const, background: BG,
    backgroundImage: `radial-gradient(1000px 620px at 50% 120%, ${hexToRgba(primary, 0.1)}, transparent)`,
    padding: "64px 72px", color: INK,
  };
}

function ChainMotif({ seed, color, big = false }: { seed: number; color: string; big?: boolean }) {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const W = 1200, H = 630;
  const count = 6 + Math.floor(rand() * 3);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const x = (W / (count - 1)) * i;
    // "big" mode keeps the chain in the top third — chainHero anchors its
    // caption text at the bottom of the same container, and a full-height
    // range put the line running straight through the text on some seeds.
    const y = big ? H * 0.08 + rand() * H * 0.26 : H * 0.28 + rand() * H * 0.5;
    points.push([x, y]);
  }
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
      <path d={d} stroke={color} strokeWidth={big ? 3 : 1.5} fill="none" opacity={big ? 0.5 : 0.22} />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 || i === points.length - 1 ? (big ? 9 : 6) : (big ? 6 : 3.5)} fill={color} opacity={big ? 0.7 : 0.32} />
      ))}
    </svg>
  );
}

function LogoMark() {
  return (
    <svg width={22} height={22} viewBox="0 0 32 32">
      <path d="M23 8 L23 24 L11 16 Z" fill="#e8873d" />
      <path d="M15 8 L15 24 L3 16 Z" fill="#3ecfb8" />
      <rect x="26.6" y="9" width="2.4" height="14" rx="1.2" fill="#f2f0ea" />
    </svg>
  );
}

/** Matches components/site/Header.tsx's actual brand lockup exactly: the bare 22x22 mark next to the wordmark, no badge/box around it. */
function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <LogoMark />
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>Runback</div>
    </div>
  );
}

function Eyebrow({ text, color, pill }: { text: string; color: string; pill: boolean }) {
  if (!pill) {
    return <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, fontWeight: 600, color }}>{text}</div>;
  }
  return (
    <div style={{ display: "flex", fontSize: 18, letterSpacing: 2, fontWeight: 600, color, padding: "8px 16px", borderRadius: 999, border: `1px solid ${color}`, background: hexToRgba(color, 0.1) }}>
      {text}
    </div>
  );
}

function HeaderRow({ c, pill }: { c: Card; pill: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Brand />
      <Eyebrow text={c.eyebrow} color={c.eyebrowColor} pill={pill} />
    </div>
  );
}

function FooterRow({ c, fixWidth = 820 }: { c: Card; fixWidth?: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 30 }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTE, lineHeight: 1.4, maxWidth: fixWidth }}>{c.fix}</div>
      <div style={{ display: "flex", fontSize: 22, color: DIM, whiteSpace: "nowrap" }}>runback.dev</div>
    </div>
  );
}

/** The verify-command terminal — the hero motif for the classic and CLI-session layouts. */
function Terminal({ ok, file = "record.json", width = 620 }: { ok: boolean; file?: string; width?: number }) {
  const color = ok ? GREEN : ROSE;
  const verdict = ok ? "VALID" : "INVALID";
  const line = ok ? "signature — verified against Runback's published key" : "chain — an event was altered after it was sealed";
  return (
    <div style={{ display: "flex", flexDirection: "column", width, borderRadius: 16, border: "1px solid rgba(242,240,234,0.12)", background: "rgba(6,7,9,0.72)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", borderBottom: "1px solid rgba(242,240,234,0.08)" }}>
        <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#3a3d44" }} />
        <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#3a3d44" }} />
        <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#3a3d44" }} />
        <div style={{ display: "flex", marginLeft: 10, fontSize: 18, color: DIM }}>your terminal — no account</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "22px 24px", gap: 14, fontSize: 24 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ color: TEAL }}>$</span>
          <span style={{ color: INK }}>npx @runback/verify {file}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 8, background: ok ? "rgba(74,222,128,0.14)" : "rgba(251,113,133,0.14)", border: `1px solid ${color}`, color, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
            {ok ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M4 12.5 L9.5 18 L20 6" stroke={GREEN} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M6 6 L18 18 M18 6 L6 18" stroke={ROSE} strokeWidth="3.2" strokeLinecap="round" />
              </svg>
            )}
            {verdict}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 19, color: MUTE, maxWidth: width - 80 }}>{line}</div>
      </div>
    </div>
  );
}

function Stat({ value, label, color = AMBER }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", fontSize: 128, fontWeight: 800, letterSpacing: -5, lineHeight: 1, color }}>{value}</div>
      <div style={{ display: "flex", fontSize: 26, color: MUTE }}>{label}</div>
    </div>
  );
}

/** A small check/x glyph, reused wherever a verdict needs marking without the full Terminal. */
function VerdictGlyph({ ok, size = 26 }: { ok: boolean; size?: number }) {
  const color = ok ? GREEN : ROSE;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {ok
        ? <path d="M4 12.5 L9.5 18 L20 6" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth="3.2" strokeLinecap="round" />}
    </svg>
  );
}

/** A stamped wax-seal / certification-style badge: concentric rings around a verdict glyph. */
function Seal({ ok, color, size = 220 }: { ok: boolean; color: string; size?: number }) {
  const r1 = size / 2, r2 = r1 - 14, r3 = r1 - 30;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r1} cy={r1} r={r1 - 3} fill="none" stroke={color} strokeWidth={2} opacity={0.35} />
      <circle cx={r1} cy={r1} r={r2} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} strokeDasharray="4 7" />
      <circle cx={r1} cy={r1} r={r3} fill={hexToRgba(color, 0.12)} stroke={color} strokeWidth={2} />
      <g transform={`translate(${r1 - 18}, ${r1 - 18})`}>
        {ok
          ? <path d="M4 19 L15 29 L32 8" stroke={ok ? GREEN : ROSE} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          : <path d="M8 8 L28 28 M28 8 L8 28" stroke={ROSE} strokeWidth="4.5" strokeLinecap="round" />}
      </g>
    </svg>
  );
}

/** A semicircular verdict gauge — the needle rests in the red zone for an incident, the green zone otherwise. */
function Gauge({ ok }: { ok: boolean }) {
  const cx = 140, cy = 140, r = 120;
  // Standard math parameterization (theta from the positive x-axis, y flipped
  // for SVG) instead of a hand-rolled clockwise-from-12-o'clock angle — the
  // original convention put "invalid" past the arc's own end, so the needle
  // barely leaned instead of pointing decisively into either zone. 135° sits
  // at the rose arc's own midpoint, 45° at the green arc's midpoint.
  const theta = (ok ? 45 : 135) * (Math.PI / 180);
  const nx = cx + r * 0.86 * Math.cos(theta);
  const ny = cy - r * 0.86 * Math.sin(theta);
  const verdict = ok ? GREEN : ROSE;
  return (
    <svg width={280} height={160} viewBox="0 0 280 160">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy - r}`} stroke={ROSE} strokeWidth={16} fill="none" opacity={0.55} strokeLinecap="round" />
      <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} stroke={GREEN} strokeWidth={16} fill="none" opacity={0.55} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={verdict} strokeWidth={5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={9} fill={INK} />
    </svg>
  );
}

/** Concentric detection rings behind a center badge — the "alert/radar" framing. */
function Radar({ color }: { color: string }) {
  return (
    <svg width={300} height={300} viewBox="0 0 300 300" style={{ position: "absolute" }}>
      {[150, 115, 80, 45].map((r, i) => (
        <circle key={r} cx={150} cy={150} r={r} fill="none" stroke={color} strokeWidth={1.5} opacity={0.14 + i * 0.06} />
      ))}
    </svg>
  );
}

/* ── Layouts — 15 structurally distinct arrangements of the same content ───
 *
 * Each takes (c, seed) and returns the full 1200x630 root element. Layout
 * SELECTION uses its own seeded stream (see GET), decorrelated from the
 * content choices in cardFor — two posts with the same accent color can
 * still land on completely different layouts, and vice versa.
 */

type Layout = (c: Card, seed: number) => ReactElement;

// L1 — the original: terminal verdict beside the headline, hash-chain texture behind.
const classicTerminal: Layout = (c, seed) => {
  const rand = mulberry32(seed ^ 0x001);
  const mirrored = rand() < 0.5;
  const pill = rand() < 0.5;
  const headlineBlock = (
    <div key="h" style={{ display: "flex", flexDirection: "column", gap: 26, flex: "1 1 0%", minWidth: 0 }}>
      {c.hero === "stat" && <Stat value={c.statValue ?? "—"} label={c.statLabel ?? ""} color={c.eyebrowColor} />}
      {c.realHeadline ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
          <div style={{ display: "flex", width: "100%", fontSize: c.headlineFontSize ?? 44, fontWeight: 700, letterSpacing: -1, lineHeight: 1.12 }}>{c.realHeadline}</div>
          {c.kicker && <div style={{ display: "flex", fontSize: 27, fontWeight: 600, color: c.eyebrowColor }}>{c.kicker}</div>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", fontSize: c.headlineFontSize ?? (c.hero === "stat" ? 46 : 58), fontWeight: 700, letterSpacing: -2, lineHeight: 1.06 }}>
          {c.headline.map((l, i) => <span key={i} style={i === c.headline.length - 1 && c.hero !== "stat" ? { color: c.eyebrowColor } : {}}>{l}</span>)}
        </div>
      )}
    </div>
  );
  const terminalBlock = <Terminal key="t" ok={c.hero !== "invalid"} file={c.file} />;
  return (
    <div style={gridBackground(seed, c.eyebrowColor)}>
      <ChainMotif seed={seed} color={c.eyebrowColor} />
      <HeaderRow c={c} pill={pill} />
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 40 }}>
        {mirrored ? [terminalBlock, headlineBlock] : [headlineBlock, terminalBlock]}
      </div>
      <FooterRow c={c} />
    </div>
  );
};

// L2 — the verdict itself, gigantic and centered; everything else is caption.
const bigVerdict: Layout = (c, seed) => (
  <div style={gridBackground(seed, c.eyebrowColor)}>
    <HeaderRow c={c} pill={false} />
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      {c.hero === "stat" ? (
        <Stat value={c.statValue ?? "—"} label={c.statLabel ?? ""} color={c.eyebrowColor} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <VerdictGlyph ok={c.hero !== "invalid"} size={64} />
          <div style={{ display: "flex", fontSize: 128, fontWeight: 800, letterSpacing: -4, color: verdictColor(c) }}>{verdictWord(c)}</div>
        </div>
      )}
      <div style={{ display: "flex", fontSize: 28, fontWeight: 600, color: c.eyebrowColor, textAlign: "center" as const, maxWidth: 820 }}>{c.kicker ?? headlineText(c)}</div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      <div style={{ display: "flex", fontSize: 20, color: MUTE, maxWidth: 780, textAlign: "center" as const, lineHeight: 1.4 }}>{c.fix}</div>
      <div style={{ display: "flex", fontSize: 20, color: DIM }}>runback.dev</div>
    </div>
  </div>
);

// L3 — a stamped seal beside the headline, like a certification mark.
const sealStamp: Layout = (c, _seed) => (
  <div style={flatBackground(c.eyebrowColor)}>
    <HeaderRow c={c} pill />
    <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
      <Seal ok={c.hero !== "invalid"} color={c.eyebrowColor} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: "1 1 0%", minWidth: 0 }}>
        <div style={{ display: "flex", fontSize: c.realHeadline ? headlineFontSizeFor(headlineText(c), 40) : 46, fontWeight: 700, letterSpacing: -1, lineHeight: 1.14 }}>{headlineText(c)}</div>
        {c.kicker && <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: c.eyebrowColor }}>{c.kicker}</div>}
      </div>
    </div>
    <FooterRow c={c} />
  </div>
);

// L4 — the headline arrives partly redacted, then the fix is the unredacted reveal. Grounded in the actual PII-redaction feature.
const redactionReveal: Layout = (c, seed) => {
  const rand = mulberry32(seed ^ 0x004);
  const words = headlineText(c).split(" ");
  return (
    <div style={gridBackground(seed, c.eyebrowColor)}>
      <HeaderRow c={c} pill={false} />
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "10px 12px", maxWidth: 980, fontSize: 40, fontWeight: 700, lineHeight: 1.3 }}>
          {words.map((w, i) => {
            const redact = i > 0 && i < words.length - 1 && rand() < 0.32;
            return redact
              ? <div key={i} style={{ display: "flex", width: Math.max(46, w.length * 20), height: 30, borderRadius: 4, background: INK, marginTop: 8 }} />
              : <span key={i}>{w}</span>;
          })}
        </div>
        <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: c.eyebrowColor }}>REDACTED — BEFORE IT EVER REACHES US</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 24, color: MUTE, maxWidth: 760, lineHeight: 1.4 }}>{c.fix}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 8, background: hexToRgba(verdictColor(c), 0.14), border: `1px solid ${verdictColor(c)}`, color: verdictColor(c), fontSize: 20, fontWeight: 700 }}>
          <VerdictGlyph ok={c.hero !== "invalid"} size={20} />{verdictWord(c)}
        </div>
      </div>
    </div>
  );
};

// L5 — a printed ledger receipt: itemized rows on a torn paper strip.
const ledgerReceipt: Layout = (c, _seed) => {
  const rows: [string, string][] = [
    ["RECORD", c.file ?? "record.json"],
    ["STATUS", verdictWord(c)],
    ["ISSUER", "runback.dev"],
  ];
  return (
    <div style={{ ...flatBackground(c.eyebrowColor), alignItems: "center" }}>
      <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}><Brand /><div /></div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 60 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 460, borderRadius: 4, border: "1px solid rgba(242,240,234,0.16)", background: "rgba(6,7,9,0.6)", padding: "26px 28px", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 2, color: DIM, borderBottom: "1px dashed rgba(242,240,234,0.2)", paddingBottom: 12 }}>VERIFICATION RECEIPT</div>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 19, borderBottom: "1px dashed rgba(242,240,234,0.12)", paddingBottom: 10, color: k === "STATUS" ? verdictColor(c) : INK }}>
              <span style={{ color: DIM }}>{k}</span><span style={{ fontWeight: k === "STATUS" ? 700 : 400 }}>{v}</span>
            </div>
          ))}
          <div style={{ display: "flex", fontSize: 16, color: DIM, marginTop: 4 }}>$ npx @runback/verify {c.file ?? "record.json"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1.16 }}>{clipLine(headlineText(c), 90)}</div>
          <div style={{ display: "flex", fontSize: 21, color: MUTE, lineHeight: 1.4 }}>{c.fix}</div>
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 20, color: DIM }}>runback.dev</div>
    </div>
  );
};

// L6 — a direct comparison: what a log gives you vs. what a sealed record gives you.
const diffCompare: Layout = (c, seed) => (
  <div style={gridBackground(seed, c.eyebrowColor)}>
    <HeaderRow c={c} pill={false} />
    <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1.16, maxWidth: 1000 }}>{clipLine(headlineText(c), 100)}</div>
    <div style={{ display: "flex", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", gap: 12, padding: "22px 24px", borderRadius: 12, border: "1px solid rgba(251,113,133,0.35)", background: "rgba(251,113,133,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 700, color: ROSE }}><VerdictGlyph ok={false} size={20} />A LOG</div>
        <div style={{ display: "flex", fontSize: 20, color: MUTE, lineHeight: 1.4 }}>Can be edited after the fact. Nobody outside your team can check it.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", gap: 12, padding: "22px 24px", borderRadius: 12, border: `1px solid ${hexToRgba(GREEN, 0.35)}`, background: hexToRgba(GREEN, 0.06) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 700, color: GREEN }}><VerdictGlyph ok size={20} />A RUNBACK RECORD</div>
        <div style={{ display: "flex", fontSize: 20, color: MUTE, lineHeight: 1.4 }}>{c.fix}</div>
      </div>
    </div>
    <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 20, color: DIM }}>runback.dev</div>
  </div>
);

// L7 — the hash chain itself, enlarged into the primary visual, not background texture.
const chainHero: Layout = (c, seed) => (
  <div style={{ ...flatBackground(c.eyebrowColor), justifyContent: "flex-start" as const, gap: 0 }}>
    <HeaderRow c={c} pill={false} />
    <div style={{ display: "flex", flex: "1 1 0%", position: "relative" as const, marginTop: 20 }}>
      <ChainMotif seed={seed} color={c.eyebrowColor} big />
      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "absolute" as const, left: 0, bottom: 30, maxWidth: 760 }}>
        <div style={{ display: "flex", fontSize: 38, fontWeight: 700, letterSpacing: -1, lineHeight: 1.16 }}>{clipLine(headlineText(c), 95)}</div>
        <div style={{ display: "flex", fontSize: 21, color: MUTE, lineHeight: 1.4 }}>{c.fix}</div>
      </div>
    </div>
    <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 20, color: DIM }}>runback.dev</div>
  </div>
);

// L8 — a verdict gauge, needle resting in the zone that matches this post.
const gaugeMeter: Layout = (c, _seed) => (
  <div style={flatBackground(c.eyebrowColor)}>
    <HeaderRow c={c} pill />
    <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
      <Gauge ok={c.hero !== "invalid"} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: "1 1 0%", minWidth: 0 }}>
        <div style={{ display: "flex", fontSize: c.realHeadline ? headlineFontSizeFor(headlineText(c), 38) : 44, fontWeight: 700, letterSpacing: -1, lineHeight: 1.14 }}>{headlineText(c)}</div>
        {c.kicker && <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: c.eyebrowColor }}>{c.kicker}</div>}
      </div>
    </div>
    <FooterRow c={c} />
  </div>
);

/** A giant outlined verdict mark, bleeding off the canvas edge — the graphic anchor for posterHeadline. Oversized-icon-bleeding-off-frame is a real poster technique, and tying it to the verdict keeps it grounded rather than decorative for its own sake. */
function GiantVerdictMark({ ok, color }: { ok: boolean; color: string }) {
  return (
    <svg width={520} height={520} viewBox="0 0 100 100" style={{ position: "absolute", top: -80, right: -80, opacity: 0.16 }}>
      <circle cx={50} cy={50} r={46} fill="none" stroke={color} strokeWidth={2} />
      {ok
        ? <path d="M22 52 L42 72 L80 28" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        : <path d="M28 28 L72 72 M72 28 L28 72" stroke={color} strokeWidth={7} strokeLinecap="round" />}
    </svg>
  );
}

// L9 — an editorial poster: the headline fills the frame, a giant verdict mark bleeds off the corner.
const posterHeadline: Layout = (c, seed) => (
  <div style={{ ...gridBackground(seed, c.eyebrowColor), justifyContent: "space-between" as const }}>
    <GiantVerdictMark ok={c.hero !== "invalid"} color={verdictColor(c)} />
    <Brand />
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", fontSize: 18, letterSpacing: 3, fontWeight: 600, color: c.eyebrowColor }}>{c.eyebrow}</div>
      <div style={{ display: "flex", fontSize: headlineFontSizeFor(headlineText(c), 62), fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, maxWidth: 1040 }}>{clipLine(headlineText(c), 90)}</div>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <div style={{ display: "flex", fontSize: 21, color: MUTE, maxWidth: 700, lineHeight: 1.4 }}>{c.fix}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 700, color: verdictColor(c) }}><VerdictGlyph ok={c.hero !== "invalid"} size={20} />{verdictWord(c)}</div>
    </div>
  </div>
);

// L10 — a fuller terminal session, several lines building to the verdict, not a single command.
const cliSession: Layout = (c, seed) => (
  <div style={gridBackground(seed, c.eyebrowColor)}>
    <HeaderRow c={c} pill={false} />
    <div style={{ display: "flex", flexDirection: "column", width: "100%", borderRadius: 16, border: "1px solid rgba(242,240,234,0.12)", background: "rgba(6,7,9,0.78)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", borderBottom: "1px solid rgba(242,240,234,0.08)" }}>
        <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#3a3d44" }} />
        <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#3a3d44" }} />
        <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#3a3d44" }} />
        <div style={{ display: "flex", marginLeft: 10, fontSize: 17, color: DIM }}>your terminal — no account</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "22px 28px", gap: 11, fontSize: 21 }}>
        <div style={{ display: "flex", gap: 10, color: MUTE }}><span style={{ color: TEAL }}>#</span>{clipLine(headlineText(c), 90)}</div>
        <div style={{ display: "flex", gap: 10 }}><span style={{ color: TEAL }}>$</span><span>npx @runback/verify {c.file ?? "record.json"}</span></div>
        <div style={{ display: "flex", gap: 10, color: MUTE }}>chain … re-derived, matches head</div>
        <div style={{ display: "flex", gap: 10, color: MUTE }}>signature … {c.hero === "invalid" ? "does not match" : "verified against published key"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderRadius: 8, background: hexToRgba(verdictColor(c), 0.14), border: `1px solid ${verdictColor(c)}`, color: verdictColor(c), fontSize: 22, fontWeight: 700, alignSelf: "flex-start" as const }}>
          <VerdictGlyph ok={c.hero !== "invalid"} size={20} />{verdictWord(c)}
        </div>
      </div>
    </div>
    <FooterRow c={c} />
  </div>
);

// L11 — a stack of records, front one showing this post's verdict — "one of many," not a one-off.
const cardStack: Layout = (c, seed) => (
  <div style={gridBackground(seed, c.eyebrowColor)}>
    <HeaderRow c={c} pill={false} />
    <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
      <div style={{ display: "flex", position: "relative" as const, width: 380, height: 230 }}>
        {/* Offset staggering, not rotation — Satori's transform support for rotate is unreliable, and plain offsets already read clearly as "a stack of records" at this scale. */}
        <div style={{ display: "flex", position: "absolute" as const, width: 320, height: 190, borderRadius: 14, border: "1px solid rgba(242,240,234,0.1)", background: "rgba(20,21,26,0.7)", top: 40, left: 60 }} />
        <div style={{ display: "flex", position: "absolute" as const, width: 320, height: 190, borderRadius: 14, border: "1px solid rgba(242,240,234,0.14)", background: "rgba(14,15,19,0.85)", top: 20, left: 30 }} />
        <div style={{ display: "flex", flexDirection: "column", position: "absolute" as const, width: 320, height: 190, borderRadius: 14, border: `1px solid ${hexToRgba(c.eyebrowColor, 0.4)}`, background: "rgba(6,7,9,0.92)", padding: "18px 20px", gap: 10, justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 15, color: DIM }}>{c.file ?? "record.json"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 7, background: hexToRgba(verdictColor(c), 0.16), border: `1px solid ${verdictColor(c)}`, color: verdictColor(c), fontSize: 18, fontWeight: 700, alignSelf: "flex-start" as const }}>
            <VerdictGlyph ok={c.hero !== "invalid"} size={16} />{verdictWord(c)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 0%", minWidth: 0 }}>
        <div style={{ display: "flex", fontSize: c.realHeadline ? headlineFontSizeFor(headlineText(c), 36) : 42, fontWeight: 700, letterSpacing: -1, lineHeight: 1.16 }}>{headlineText(c)}</div>
        {c.kicker && <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: c.eyebrowColor }}>{c.kicker}</div>}
      </div>
    </div>
    <FooterRow c={c} />
  </div>
);

// L12 — detection rings behind a center verdict badge, alert framing.
const radarAlert: Layout = (c, _seed) => (
  <div style={{ ...flatBackground(c.eyebrowColor), alignItems: "center" }}>
    <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}><Brand /><Eyebrow text={c.eyebrow} color={c.eyebrowColor} pill={false} /></div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" as const, width: 300, height: 300 }}>
      <Radar color={c.eyebrowColor} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderRadius: 999, background: hexToRgba(verdictColor(c), 0.16), border: `2px solid ${verdictColor(c)}`, color: verdictColor(c), fontSize: 26, fontWeight: 800 }}>
        <VerdictGlyph ok={c.hero !== "invalid"} size={24} />{verdictWord(c)}
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 700, textAlign: "center" as const, maxWidth: 860, lineHeight: 1.2 }}>{clipLine(headlineText(c), 90)}</div>
      <div style={{ display: "flex", fontSize: 20, color: MUTE, textAlign: "center" as const, maxWidth: 780 }}>{c.fix}</div>
    </div>
  </div>
);

// L13 — background split on a diagonal seam; the headline straddles it.
const diagonalSplit: Layout = (c, _seed) => (
  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", background: BG, padding: "64px 72px", color: INK }}>
    <svg width={1200} height={630} viewBox="0 0 1200 630" style={{ position: "absolute", inset: 0 }}>
      <polygon points="0,0 1200,0 1200,260 0,470" fill={hexToRgba(c.eyebrowColor, 0.14)} />
    </svg>
    <HeaderRow c={c} pill={false} />
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", fontSize: headlineFontSizeFor(headlineText(c), 48), fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1 }}>{clipLine(headlineText(c), 95)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 700, color: verdictColor(c) }}><VerdictGlyph ok={c.hero !== "invalid"} size={20} />{verdictWord(c)} · {c.file ?? "record.json"}</div>
    </div>
    <FooterRow c={c} fixWidth={760} />
  </div>
);

/** A giant decorative quotation mark, the graphic anchor for the quote-card layout — grounds the "pull-quote" framing in an actual shape instead of leaving the card as flat centered text. */
function GiantQuoteMark({ color }: { color: string }) {
  return (
    <svg width={220} height={220} viewBox="0 0 100 100" style={{ position: "absolute", top: 20, left: 40, opacity: 0.15 }}>
      <path d="M20 35 Q20 15 40 12 L40 22 Q28 24 28 35 L38 35 L38 58 L14 58 Z" fill={color} />
      <path d="M58 35 Q58 15 78 12 L78 22 Q66 24 66 35 L76 35 L76 58 L52 58 Z" fill={color} />
    </svg>
  );
}

// L14 — nearly bare: a single large statement, quote-card treatment, anchored by a real graphic mark instead of flat text alone.
const quoteMinimal: Layout = (c, seed) => (
  <div style={{ ...gridBackground(seed, c.eyebrowColor), alignItems: "center", justifyContent: "center" as const, gap: 34 }}>
    <GiantQuoteMark color={c.eyebrowColor} />
    <div style={{ display: "flex", fontSize: 18, letterSpacing: 3, fontWeight: 600, color: c.eyebrowColor }}>{c.eyebrow}</div>
    <div style={{ display: "flex", fontSize: 56, fontWeight: 700, letterSpacing: -2, lineHeight: 1.16, textAlign: "center" as const, maxWidth: 940 }}>
      “{c.kicker ?? c.fix}”
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <LogoMark /><div style={{ display: "flex", fontSize: 22, color: MUTE }}>runback.dev</div>
    </div>
  </div>
);

// L15 — a small dashboard: four bordered tiles instead of one composition.
const dashboardTiles: Layout = (c, seed) => {
  const tile = (label: string, content: ReactElement, accent?: string) => (
    <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", gap: 8, padding: "20px 22px", borderRadius: 12, border: `1px solid ${accent ? hexToRgba(accent, 0.4) : "rgba(242,240,234,0.12)"}`, background: "rgba(20,21,26,0.55)" }}>
      <div style={{ display: "flex", fontSize: 15, letterSpacing: 2, color: DIM }}>{label}</div>
      {content}
    </div>
  );
  return (
    <div style={gridBackground(seed, c.eyebrowColor)}>
      <HeaderRow c={c} pill={false} />
      <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: "1 1 0%", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 18 }}>
          {tile("SIGNAL", <div style={{ display: "flex", fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{clipLine(headlineText(c), 60)}</div>)}
          {tile("VERDICT", <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 24, fontWeight: 800, color: verdictColor(c) }}><VerdictGlyph ok={c.hero !== "invalid"} size={20} />{verdictWord(c)}</div>, verdictColor(c))}
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {tile("MECHANISM", <div style={{ display: "flex", fontSize: 19, color: MUTE, lineHeight: 1.4 }}>{c.fix}</div>)}
          {tile("VERIFY", <div style={{ display: "flex", fontSize: 17, color: TEAL }}>$ npx @runback/verify {c.file ?? "record.json"}</div>, c.eyebrowColor)}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 20, color: DIM }}>runback.dev</div>
    </div>
  );
};

const LAYOUTS: Layout[] = [
  classicTerminal, bigVerdict, sealStamp, redactionReveal, ledgerReceipt,
  diffCompare, chainHero, gaugeMeter, posterHeadline, cliSession,
  cardStack, radarAlert, diagonalSplit, quoteMinimal, dashboardTiles,
];

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const type = q.get("type") ?? "default";

  // Deterministic per-post seed: same post content -> same image (stable
  // across retries and CDN/Buffer caching), different content -> a visibly
  // different card.
  const seed = djb2([type, q.get("headline"), q.get("model"), q.get("stat"), q.get("cause")].filter(Boolean).join("|"));
  const c = cardFor(type, q, seed);

  const layout = LAYOUTS[pickLayoutIndex(seed)];
  return new ImageResponse(layout(c, seed), { width: 1200, height: 630 });
}

/** Layout selection, decorrelated from the content seed (own salt) so a card's structure doesn't track its accent color or copy choice — two posts that happen to share a color can still land on different layouts. Exported so tests can check the distribution and determinism without rendering. */
export function pickLayoutIndex(seed: number): number {
  return Math.floor(mulberry32(seed ^ 0x2545f491)() * LAYOUTS.length);
}

export const LAYOUT_COUNT = LAYOUTS.length;
