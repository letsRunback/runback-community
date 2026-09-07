import crypto from "crypto";
import { generateText } from "ai";
import { resolveModel } from "@/lib/replay/runStep";
import { pickJudgeModel } from "@/lib/eval/judge";

export type Platform = "linkedin" | "twitter" | "bluesky";
export type SignalType = "regulatory" | "model_release" | "incident" | "fleet_weekly";

export interface SocialSignal {
  type: SignalType;
  title: string;
  summary?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}

const SITE = "https://runback.dev";

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// Every post ships with a purpose-built card, not a raw product screenshot.
//
// A screenshot of an unfamiliar dashboard is noise in a feed — no context, no
// tension, nothing legible in the half-second before a thumb moves on. The
// dynamic card (/api/social-card) leads with the reader's problem and shows the
// one thing that is uniquely Runback and actually striking: a terminal
// verifying, or refusing, a record. It is built per signal from live metadata
// (the weekly count, the model name, the top cause), so the image argues the
// same point the caption does.
export function imageForSignal(signal: SocialSignal): string {
  const p = new URLSearchParams({ type: signal.type });
  const m = signal.metadata ?? {};
  if (signal.type === "fleet_weekly") {
    if (m.run_count != null) p.set("stat", Number(m.run_count).toLocaleString());
    if (m.top_cause) p.set("cause", String(m.top_cause));
  }
  if (signal.type === "model_release") {
    const model = (m.model as string) || clip(signal.title, 40);
    if (model) p.set("model", model);
  }
  // regulatory and incident used to render a fixed headline regardless of
  // which signal fired — every regulatory post got the literal same image
  // URL, every incident post got the literal same image URL, so Buffer (and
  // LinkedIn's own og-image cache, keyed on the URL) served one identical
  // image for every post of that type. The signal's own title is real,
  // per-post content already sitting right here — passing it through is what
  // makes the card (and therefore the URL) actually unique per post.
  if ((signal.type === "regulatory" || signal.type === "incident") && signal.title) {
    p.set("headline", clip(signal.title, 90));
  }
  return `${SITE}/api/social-card?${p.toString()}`;
}

const TAGS: Record<SignalType, string[]> = {
  regulatory: ["#EUAIAct", "#AIGovernance", "#Compliance", "#AuditTrail"],
  model_release: ["#LLM", "#AIAgents", "#MLOps", "#AIGovernance"],
  incident: ["#AISafety", "#AIGovernance", "#AIIncident"],
  fleet_weekly: ["#AIGovernance", "#AuditTrail", "#AIAgents"],
};

/* ── Deterministic fallback templates ────────────────────────────────────────
 *
 * Used only when the model call is unavailable or its output fails
 * validation below — reliability for a once-a-day cron matters more than any
 * single post's polish. These are intentionally rigid; they are NOT what
 * ships under normal operation, which is why the sameness that made the old
 * all-template system read as bot-generated is tolerable here.
 */

function templateRegulatory(signal: SocialSignal, short: boolean): string {
  const summary = signal.summary ? clip(signal.summary, 180) : "";
  if (short) {
    return `${clip(signal.title, 130)}\n\nApplication logs can be edited after the fact, so they aren't evidence.\n\nRunback seals every agent decision in a record an auditor verifies without trusting you.\n\n${SITE}/eu-ai-act`;
  }
  const trigger = summary ? `${signal.title} — ${summary}` : signal.title;
  return `When the auditor asks "show me what the model actually saw," your logs are not enough — they can be edited after the fact.\n\nWhat triggered this post: ${trigger}\n\nRunback fixes that: every agent decision is sealed in a tamper-evident record, time-stamped by an authority we don't control, that anyone can verify in their terminal — no account, no Runback software:\n\n  npx @runback/verify record.json  →  VALID\n\n${SITE}/eu-ai-act\n\n${TAGS.regulatory.join(" ")}`;
}

function templateModelRelease(signal: SocialSignal, short: boolean): string {
  const model = (signal.metadata?.model as string) || clip(signal.title, 80);
  if (short) {
    return `${model} is out.\n\nThe real risk is that your agent behaves differently after the upgrade, and you find out in production.\n\nRunback replays 90 days of your real decisions against it first.\n\n${SITE}/how-it-works`;
  }
  return `${model} is out. Most teams find out whether their agents still behave the same way after an upgrade in production.\n\nRunback replays your last 90 days of real agent decisions against the new model before you ship it. Behavioural drift surfaces as a diff you can review.\n\n${SITE}/how-it-works\n\n${TAGS.model_release.join(" ")}`;
}

function templateIncident(signal: SocialSignal, short: boolean): string {
  const summary = signal.summary ? clip(signal.summary, 150) : "";
  if (short) {
    return `${clip(signal.title, 120)}\n\nRoot cause: no record of what the model saw and decided that survives review.\n\nRunback makes every decision replayable and tamper-evident.\n\n${SITE}/how-it-works`;
  }
  const trigger = summary ? `${signal.title} — ${summary}` : signal.title;
  return `Nobody can prove what a model saw, decided, or why, when the only record is a log that could have been changed afterwards.\n\nThe latest example: ${trigger}\n\nRunback gives you a record that can't be reconstructed after the fact, and lets you re-run the exact decision from the exact inputs.\n\n${SITE}/how-it-works\n\n${TAGS.incident.join(" ")}`;
}

function templateFleetWeekly(signal: SocialSignal, short: boolean): string {
  const runs = ((signal.metadata?.run_count as number) ?? 0).toLocaleString();
  const topCause = (signal.metadata?.top_cause as string) ?? "policy deviation";
  if (short) {
    return `${runs} AI agent decisions sealed in verifiable records this week.\n\nTop signal: ${clip(topCause, 60)}.\n\nEvery one checkable in a terminal, no account needed.\n\n${SITE}`;
  }
  return `${runs} AI agent decisions sealed in tamper-evident records this week across the fleet.\n\nTop signal: ${topCause}.\n\nEvery one is hash-chained, independently verifiable, and re-runnable against its original inputs.\n\nRun the check yourself, no account:\n  npx @runback/verify record.json\n\n${SITE}\n\n${TAGS.fleet_weekly.join(" ")}`;
}

/** The old, rigid behavior — exported so it stays covered by tests and available as a safety net. */
export function generateFallbackPost(signal: SocialSignal, platform: Platform): string {
  const isShort = platform === "twitter" || platform === "bluesky";
  const maxLen = platform === "twitter" ? 280 : platform === "bluesky" ? 300 : 1300;

  let post: string;
  switch (signal.type) {
    case "regulatory":    post = templateRegulatory(signal, isShort);    break;
    case "model_release": post = templateModelRelease(signal, isShort); break;
    case "incident":      post = templateIncident(signal, isShort);     break;
    case "fleet_weekly":  post = templateFleetWeekly(signal, isShort);  break;
    default:              post = clip(signal.title, maxLen);            break;
  }
  return clip(post, maxLen);
}

/* ── Model-generated posts ────────────────────────────────────────────────────
 *
 * The fixed templates above were the actual bot-tell: every post of a given
 * signal type used the identical rhetorical skeleton ("the real risk isn't
 * X — it's Y", "strip away the details...") forever, just with nouns swapped.
 * A reader who sees two of these notices the pattern immediately, and so does
 * platform spam detection. The fix is not better copywriting inside the same
 * template — it's not having one fixed template. Structure (the "angle") and
 * hashtag use are chosen by CODE, not left to the model's own habits, because
 * an LLM given the same prompt repeatedly drifts toward its own favorite
 * constructions just as reliably as a hand-written template does.
 */

const ANGLES = [
  "Open with one flat, declarative sentence stating the situation — no framing, no meta-commentary like 'here's the thing' or 'let's talk about'. Just state it.",
  "Open with a real, specific question aimed at someone in this exact situation — not a rhetorical throwaway.",
  "Open by describing a concrete moment the reader has plausibly been in, second person ('You just...' / 'It's 2am and...').",
  "Open by naming what most people assume is true here, then complicate it in your own words — do NOT use the construction 'X isn't the problem, Y is' or any close variant of it.",
  "Open by stating the news or fact plainly in one short line, then one sentence on why it matters to the reader specifically.",
] as const;

const BANNED_PHRASES = [
  "here's the catch",
  "here's the thing",
  "strip away the details",
  "isn't the problem",
  "isn't the risk",
  "the real risk isn't",
  "the real question isn't",
  "let's be honest",
  "in today's fast-paced",
  "game-changing",
  "game changer",
  "revolutionizing",
  "unlock the power",
  "at the end of the day",
  "it's not just about",
  // First-person invented-anecdote tells: none of the signal types carry a
  // personal story, so a model reaching for "concreteness" here is
  // fabricating one — exactly the kind of claim this whole product argues
  // against making. Caught here rather than left to "don't invent facts"
  // alone, since a fabricated anecdote doesn't introduce a new number or
  // named fact the grounding check would catch.
  "i've been there",
  "we've been there",
  "we missed it",
  "we found out",
  "in my experience",
  "happened to me",
  "happened to us",
  "i once",
  "we once",
  "true story",
];

function pick<T>(arr: readonly T[]): T {
  return arr[crypto.randomInt(arr.length)];
}

/** 0/1/2 relevant tags, chosen by code — never the same static block every time. */
export function pickHashtags(type: SignalType): string[] {
  const pool = TAGS[type];
  const roll = crypto.randomInt(5); // 0-2 -> none (60%), 3 -> one (20%), 4 -> two (20%)
  if (roll < 3) return [];
  const count = roll === 3 ? 1 : 2;
  const shuffled = [...pool].sort(() => crypto.randomInt(3) - 1);
  return shuffled.slice(0, count);
}

export function violatesBannedPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.find((p) => lower.includes(p)) ?? null;
}

/** Any 2+ digit number in the draft must trace back to the signal itself — a model asked to "make it concrete" will otherwise invent a plausible-sounding stat. */
export function hasInventedNumber(text: string, signal: SocialSignal): boolean {
  const grounding = `${signal.title} ${signal.summary ?? ""} ${JSON.stringify(signal.metadata ?? {})}`;
  const groundedNumbers = new Set((grounding.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, "")));
  const draftNumbers = text.match(/\d[\d,]*/g) ?? [];
  return draftNumbers.some((n) => {
    const clean = n.replace(/,/g, "");
    // Single digits (platform names like "GPT-4", years already in the URL, etc.) are noise, not stats.
    if (clean.length < 2) return false;
    return !groundedNumbers.has(clean);
  });
}

function linkForSignal(signal: SocialSignal): string {
  return signal.type === "regulatory" ? `${SITE}/eu-ai-act` : signal.type === "fleet_weekly" ? SITE : `${SITE}/how-it-works`;
}

/**
 * A plain end-clip (like the fallback templates use) can land mid-URL — a
 * broken link in a real post is worse than the rigid-but-correct template it
 * replaced. Cuts trailing content after the link first, then only shrinks
 * the text before the link if the link itself is what's tight, keeping the
 * link always fully intact. Returns null if even the bare link doesn't fit
 * this platform's limit (caller falls back to template in that case).
 */
function clipPreservingLink(text: string, maxLen: number, link: string): string | null {
  if (text.length <= maxLen) return text;
  const idx = text.indexOf(link);
  if (idx === -1) return null;
  const linkEnd = idx + link.length;
  const droppedTrailing = text.slice(0, linkEnd);
  if (droppedTrailing.length <= maxLen) return droppedTrailing;
  const room = maxLen - link.length - 1; // -1 for the ellipsis character
  if (room < 0) return null;
  const before = text.slice(0, idx).trimEnd();
  return `${before.slice(0, room)}…${link}`;
}

function buildPrompt(signal: SocialSignal, platform: Platform, angle: string, hashtags: string[]): string {
  const maxLen = platform === "twitter" ? 280 : platform === "bluesky" ? 300 : 1300;
  const link = linkForSignal(signal);
  const facts = [
    `Signal type: ${signal.type}`,
    `Title: ${signal.title}`,
    signal.summary ? `Summary: ${signal.summary}` : null,
    signal.metadata && Object.keys(signal.metadata).length ? `Data: ${JSON.stringify(signal.metadata)}` : null,
  ].filter(Boolean).join("\n");

  return `You are writing one social media post for Runback, a tool that seals AI agent decisions into tamper-evident, independently verifiable records (like a flight recorder for AI agents). You are writing as a founder/builder posting personally, not a brand account.

FACTS YOU MAY USE (do not add any fact, number, or claim not in this list):
${facts}

REQUIRED:
- Platform: ${platform}. Hard limit ${maxLen} characters, including the link and any hashtags.
- Must include this exact link somewhere in the post: ${link}
- ${angle}
- Plain, conversational language. Contractions are fine. No corporate voice, no superlatives, no emoji.
- Do not use any of these phrases or close variants: ${BANNED_PHRASES.join("; ")}.
- Do not invent statistics, dates, customer stories, or numbers beyond what's in FACTS above.
- Do not write this as a personal anecdote ("I've been there", "we found out", "this happened to us") — FACTS is a general industry example, not something that happened to you or your team. Describe it in third person as an example, not a first-person story.
${hashtags.length ? `- End with exactly these hashtags, nothing else added: ${hashtags.join(" ")}` : `- Do not use any hashtags.`}

Write only the post text. No preamble, no quotation marks around it, no "Here's a post:" — just the post itself.`;
}

async function generateWithModel(signal: SocialSignal, platform: Platform): Promise<string | null> {
  const maxLen = platform === "twitter" ? 280 : platform === "bluesky" ? 300 : 1300;
  const modelId = pickJudgeModel();
  let model;
  try {
    model = resolveModel(modelId, "groq");
  } catch {
    return null; // no model key configured on this deployment — fall back silently
  }

  const link = linkForSignal(signal);

  for (let attempt = 0; attempt < 2; attempt++) {
    const angle = pick(ANGLES);
    const hashtags = pickHashtags(signal.type);
    try {
      const { text } = await generateText({
        model,
        prompt: buildPrompt(signal, platform, angle, hashtags),
        temperature: 0.9,
      });
      const draft = text.trim().replace(/^["'`]+|["'`]+$/g, "");
      if (!draft) continue;
      if (violatesBannedPhrase(draft)) continue;
      if (hasInventedNumber(draft, signal)) continue;
      if (!draft.includes(link)) continue; // the exact link must actually be present, intact
      const fitted = clipPreservingLink(draft, maxLen, link);
      if (!fitted) continue; // couldn't shorten without breaking the link — try again
      return fitted;
    } catch (e) {
      console.warn(`[socialContent] model generation failed (attempt ${attempt + 1}):`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

/**
 * Generates one post for one signal/platform. Tries the model first — real
 * variety in structure and voice, grounded strictly in the signal's own
 * facts. Falls back to the deterministic template (generateFallbackPost) if
 * no model key is configured, the model call fails, or the draft fails
 * grounding/banned-phrase validation twice — reliability for the cron beats
 * holding out for a perfect post.
 */
export async function generatePost(signal: SocialSignal, platform: Platform): Promise<string> {
  const fromModel = await generateWithModel(signal, platform);
  return fromModel ?? generateFallbackPost(signal, platform);
}
