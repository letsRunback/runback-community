#!/usr/bin/env -S npx tsx
/**
 * runback — re-run a stored agent run on a different model, against the recording.
 *
 *   # 1. scaffold an agent file (one command — gives you a working template)
 *   npx tsx node_modules/@runback/sdk/bin/runback.ts replay --init
 *
 *   # 2. replay a real run on another model, using YOUR agent
 *   RUNBACK_API_KEY=… npx tsx node_modules/@runback/sdk/bin/runback.ts replay \
 *       --run <run_id> --model claude-sonnet-4-6 --agent ./runback-agent.mjs
 *
 * The hybrid engine serves every recorded tool output on a content HIT (so the run
 * is held fixed) and goes live only where the new model genuinely diverges — the
 * true alternate timeline, not a guess.
 */
import { writeFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { replayRun } from "../src/index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const TEMPLATE = `// Your agent, ready for \`runback replay\`.
// Wrap each tool with \`tool(name, liveFn)\`: on replay the RECORDED output is served
// for a call the recording already has; your liveFn only runs for a NEW call the
// changed model decides to make. Call your model with \`model\`. Return the output.

export default async function agent({ tool, model }) {
  const search = tool("search", async (query) => {
    // your real tool — only runs on a divergence the recording didn't capture
    const res = await fetch("https://api.example.com/search?q=" + encodeURIComponent(query));
    return res.json();
  });

  // ── your agent loop ──
  // const result = await generateText({ model: yourProvider(model), tools: { search }, prompt: task });
  // return result.text;
  await search("example");
  return "done";
}
`;

async function main() {
  const cmd = process.argv[2];
  if (cmd !== "replay") {
    console.error("usage: runback replay --run <id> --model <model> --agent <file>\n       runback replay --init");
    process.exit(2);
  }

  if (has("init")) {
    const out = "runback-agent.mjs";
    if (existsSync(out)) { console.error(`✗ ${out} already exists — not overwriting.`); process.exit(1); }
    writeFileSync(out, TEMPLATE);
    console.error(`✓ wrote ${out}\n\nNext:\n  RUNBACK_API_KEY=… npx tsx node_modules/@runback/sdk/bin/runback.ts replay \\\n      --run <run_id> --model claude-sonnet-4-6 --agent ./${out}`);
    return;
  }

  const runId = arg("run");
  const model = arg("model");
  const agentPath = arg("agent");
  const team = arg("team"); // optional: attribute this run to a named team for chargeback
  if (!runId || !model || !agentPath) {
    console.error("replay needs --run <id>, --model <model>, and --agent <file>. (Run `replay --init` for a template.)");
    process.exit(2);
  }
  if (!process.env.RUNBACK_API_KEY && !arg("key")) {
    console.error("Set RUNBACK_API_KEY (or pass --key) so the cassette can be fetched.");
    process.exit(2);
  }

  const full = isAbsolute(agentPath) ? agentPath : resolve(process.cwd(), agentPath);
  let agent: (deps: { tool: unknown; model: string }) => unknown;
  try {
    const mod = await import(pathToFileURL(full).href);
    agent = mod.default ?? mod.agent;
    if (typeof agent !== "function") throw new Error("the agent file must `export default` a function");
  } catch (e) {
    console.error(`✗ couldn't load agent ${agentPath}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.error(`▸ replaying ${runId} on ${model} …${team ? ` (team: ${team})` : ""}`);
  try {
    const { outcome } = await replayRun({
      runId,
      model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: agent as any,
      apiKey: arg("key") ?? process.env.RUNBACK_API_KEY,
      ingestUrl: arg("ingest") ?? process.env.RUNBACK_INGEST_URL,
      // Pass team in metadata so the server can resolve it to a team_id via name lookup or prefix rules
      metadata: team ? { team } : undefined,
    });
    const live = outcome.provenance.filter((p) => p.source !== "recorded").length;
    console.error(
      `\n${outcome.frontier ? "⑂ forked" : "✓ reproduced"} · ` +
      `held identical through ${outcome.reproducedPrefix} read${outcome.reproducedPrefix === 1 ? "" : "s"}` +
      (outcome.frontier ? `, then diverged at ${outcome.frontier.name ?? outcome.frontier.kind}` : "") +
      ` · ${outcome.hits} served from recording · ${live} live`
    );
    process.exit(0);
  } catch (e) {
    console.error(`✗ replay failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

main();
