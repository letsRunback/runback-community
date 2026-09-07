#!/usr/bin/env -S npx tsx
/**
 * runback-gate — the CI release gate as a command.
 *
 *   npx tsx node_modules/@runback/replay/bin/gate.ts \
 *       --baseline baseline.cassette.json \
 *       --agent ./agent.replay.ts \
 *       [--expect <cassette_digest from the signed audit>]
 *
 * The --agent module default-exports the agent replay body:
 *   export default async (play) => { const tool = play.tool("name"); ... }
 *
 * Exits 0 if the agent reproduces the baseline (offline, no model calls), else 1.
 */
import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCassette, replayGate, formatGateReport } from "../src/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baselinePath = arg("baseline");
const agentPath = arg("agent");
const expectDigest = arg("expect");

if (!baselinePath || !agentPath) {
  console.error("usage: runback-gate --baseline <cassette.json> --agent <module> [--expect <digest>]");
  process.exit(2);
}

const baseline = loadCassette(JSON.parse(readFileSync(baselinePath, "utf8")));
const abs = isAbsolute(agentPath) ? agentPath : resolve(process.cwd(), agentPath);
const mod = await import(pathToFileURL(abs).href);
const body = mod.default ?? mod.replayBody;
if (typeof body !== "function") {
  console.error(`agent module ${agentPath} must default-export (or export 'replayBody') a function`);
  process.exit(2);
}

const result = await replayGate(baseline, body, expectDigest ? { expectDigest } : undefined);
console.log(formatGateReport(result));
process.exit(result.passed ? 0 : 1);
