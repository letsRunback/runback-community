import { NextRequest, NextResponse } from "next/server";
import { getDataset, addSyntheticItem } from "@/lib/eval/datasets";
import { proposeAdversarialScenarios, scenarioToItem } from "@/lib/eval/adversarial";
import { isNearDuplicateText } from "@/lib/eval/corpusMiner";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isDemoRequest } from "@/lib/demoMode";
import { inputTextOf } from "@runback/policy";

export const runtime = "nodejs";
export const maxDuration = 60;

interface GenerateBody {
  count?: number;
}

/**
 * Propose N adversarial scenarios for a dataset, seeded from its first
 * captured (non-synthetic) item's system prompt + tools. Every scenario lands
 * `source: "synthetic"`, `approval_status: "pending"` — it does not count
 * toward any eval's gating_pass_rate until a human approves it via the
 * review endpoint. See web/lib/eval/adversarial.ts for the full rationale.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ dataset_id: string }> }) {
  const { dataset_id } = await params;

  // Generation calls a model — throttle like the eval endpoint does.
  const rl = await rateLimit(`adversarial:${clientIp(req)}`, 6, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many generation requests — give it a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const { getSession } = await import("@/lib/auth");
  const session = await getSession().catch(() => null);
  if (!session?.orgId) {
    return NextResponse.json({ error: "Sign in to generate adversarial tests." }, { status: 401 });
  }
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!(await orgHasFeature(session.orgId, "upgrade_gate"))) {
    return NextResponse.json({ error: "Adversarial test generation requires the release-gate plan tier." }, { status: 403 });
  }

  const dataset = await getDataset(dataset_id, session.orgId);
  if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

  let body: GenerateBody = {};
  try {
    body = (await req.json()) as GenerateBody;
  } catch { /* empty body is fine — defaults apply */ }
  const count = Math.max(1, Math.min(10, body.count ?? 5));

  // Seed generation from the first captured item's context, if any — a
  // dataset with only synthetic items so far has nothing to ground against,
  // so it falls back to a contextless prompt (still useful, just less sharp).
  const seed = dataset.items.find((it) => it.source === "captured");

  // BYOK, same as every other model call in the codebase — without this an
  // org with only OPENAI_API_KEY/ANTHROPIC_API_KEY (no Groq) configured could
  // never generate adversarial scenarios, even though judge/replay/pairwise
  // all work fine for them.
  const { getOrgKeys } = await import("@/lib/modelKeys");
  const orgKeys = await getOrgKeys(session.orgId);

  // proposeAdversarialScenarios retries internally on unparseable output
  // before giving up — a thrown error here means it genuinely couldn't
  // produce anything usable, not a one-off worth retrying again client-side.
  let scenarios;
  try {
    scenarios = await proposeAdversarialScenarios(
      {
        system: seed?.request?.system ?? null,
        tools: (seed?.request?.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
        count,
      },
      orgKeys,
      await isDemoRequest()
    );
  } catch (err) {
    console.error("[api/datasets/adversarial] generation failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not generate scenarios" }, { status: 502 });
  }

  // Content-level dedup on top of the human-review gate: two prompts run
  // scenarios by hand and a bland corpus that's mostly paraphrases of the same
  // attack isn't more useful than one copy of it — see corpusMiner.ts's
  // isNearDuplicateText for why signal-key dedup alone (the cron path) isn't
  // enough. Seeded from every item already in the dataset, grown as this
  // batch adds items, so duplicates are caught within the batch too.
  const seenTexts: string[] = dataset.items.map((it) => inputTextOf(it.request)).filter((t): t is string => !!t);
  let duplicatesSkipped = 0;

  const created = [];
  for (const scenario of scenarios) {
    const item = scenarioToItem(scenario, seed?.request?.system ?? null);
    const candidateText = inputTextOf(item.request);
    if (candidateText && isNearDuplicateText(candidateText, seenTexts)) {
      duplicatesSkipped++;
      continue;
    }
    try {
      created.push(
        await addSyntheticItem({
          dataset_id,
          label: item.label,
          request: item.request,
          model: seed?.model ?? { provider: "groq", model_id: "llama-3.3-70b-versatile" },
          scorers: item.scorers,
          generated_rationale: item.generated_rationale,
          generated_from_run_id: seed?.source_run_id ?? null,
        })
      );
      if (candidateText) seenTexts.push(candidateText);
    } catch (err) {
      // Almost certainly sql/add_adversarial_provenance.sql hasn't been run yet
      // — that hint is useful to an operator, but the raw DB error (which can
      // include column/table names) goes to the server log, not the response.
      console.error("[api/datasets/adversarial] save failed:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "Could not save generated scenarios — has sql/add_adversarial_provenance.sql been applied?" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ items: created, duplicates_skipped: duplicatesSkipped }, { status: 201 });
}
