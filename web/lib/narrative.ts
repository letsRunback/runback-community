import type { TraceEvent, LlmEvent, ToolEvent } from "@runback/schema";
import type { RunRow } from "@/lib/runs";

/**
 * Turn a machine trace into plain English. Powers the per-step captions and the
 * one-line run summary that make a run legible to a non-technical reader.
 */

// Common tool names → human verbs. Falls back to a humanized name.
const INFINITIVE: Record<string, string> = {
  web_search: "search the web",
  search: "search the web",
  fetch_url: "read a page",
  fetch: "read a page",
  browse: "browse a page",
  send_email: "send an email",
  email: "send an email",
  summarize: "summarize",
  query_db: "query the database",
  sql: "run a database query",
  calculator: "do a calculation",
};
const PAST: Record<string, string> = {
  web_search: "searched the web",
  search: "searched the web",
  fetch_url: "read a page",
  fetch: "read a page",
  browse: "browsed a page",
  send_email: "sent an email",
  email: "sent an email",
  summarize: "summarized",
  query_db: "queried the database",
  sql: "ran a database query",
  calculator: "did a calculation",
};

function humanize(name: string): string {
  return name.replace(/[_-]+/g, " ").trim();
}
const toInfinitive = (n: string) => INFINITIVE[n] ?? `use ${humanize(n)}`;
const toPast = (n: string) => PAST[n] ?? `used ${humanize(n)}`;

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** A short caption describing what a single step did, in plain language. */
export function stepCaption(e: TraceEvent): string | null {
  switch (e.type) {
    case "llm": {
      const llm = e as LlmEvent;
      if (llm.error) return "the model hit an error";
      if (llm.response.tool_calls.length > 0) {
        const phrase = joinPhrases(
          llm.response.tool_calls.map((tc) => toInfinitive(tc.tool_name))
        );
        return `decided to ${phrase}`;
      }
      if (llm.response.text) return "wrote its answer";
      return "thought about what to do next";
    }
    case "tool": {
      const t = e as ToolEvent;
      if (t.policy_block) return `tried to ${toInfinitive(t.tool_name)} — blocked by policy`;
      if (t.error) return `tried to ${toInfinitive(t.tool_name)} — failed`;
      return toPast(t.tool_name);
    }
    case "reasoning":
      return "reasoned about the task";
    case "run":
      return e.phase === "start" ? "run started" : "run finished";
    case "env":
      return null; // substrate detail — not a narrated step
  }
}

export interface RunSummary {
  line: string;
  tone: "success" | "error" | "running";
}

/** One-sentence plain-English summary of the whole run. */
export function runSummary(run: RunRow, events: TraceEvent[]): RunSummary {
  const tools = events.filter((e): e is ToolEvent => e.type === "tool");
  const verbs = joinPhrases(
    tools.filter((t) => !t.error).map((t) => toPast(t.tool_name))
  );

  if (run.status === "error") {
    const failed =
      tools.find((t) => t.error) ??
      events.find((e) => (e.type === "llm" || e.type === "run") && e.error);
    let where = "partway through";
    let reason = "";
    if (failed?.type === "tool") {
      where = `at the ${humanize(failed.tool_name)} step`;
      reason = failed.error ? ` — ${failed.error.message}` : "";
    } else if (failed && "error" in failed && failed.error) {
      reason = ` — ${failed.error.message}`;
    }
    const did = verbs ? `It ${verbs}, then failed ${where}` : `It failed ${where}`;
    return { line: `${did}.${reason ? reason : ""}`, tone: "error" };
  }

  if (run.status === "running") {
    return { line: `Still running — ${run.step_count} step(s) so far.`, tone: "running" };
  }

  const did = verbs ? `It ${verbs}, and finished successfully` : "It finished successfully";
  return { line: `${did}.`, tone: "success" };
}

/** "Step N of M" label for a given event among the run's steps. */
export function stepPosition(e: TraceEvent, events: TraceEvent[]): string | null {
  if (e.type === "run") return null;
  const steps = events.filter((x) => x.type !== "run");
  const idx = steps.findIndex((x) => x.span_id === e.span_id);
  if (idx < 0) return null;
  return `Step ${idx + 1} of ${steps.length}`;
}
