import { generateText, stepCountIs } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { withDebugger } from "@runback/sdk";
import { tools } from "./tools.js";

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM = `You are a research assistant agent. Given a task, you:
1. Use web_search to find relevant sources.
2. Use fetch_url to read the most relevant result.
3. Write a concise 3-sentence summary.
4. Use send_email to send the summary to the address given in the task.

Always finish by calling send_email. Use the exact recipient address stated in the task.`;

export interface AgentResult {
  runId: string;
  text: string;
  status: "success" | "error";
}

/** Run the research→email agent under Runback instrumentation. */
export async function runAgent(task: string): Promise<AgentResult> {
  const dbg = withDebugger(groq(process.env.GROQ_MODEL || "openai/gpt-oss-120b"), {
    runName: "research-email-agent",
    input: task,
    tags: { example: "research-email-agent", sdk: "@runback/sdk@0.1.0" },
  });

  try {
    const result = await generateText({
      model: dbg.model,
      tools: dbg.tools(tools),
      stopWhen: stepCountIs(8),
      system: SYSTEM,
      prompt: task,
    });
    await dbg.finish({ output: result.text, status: "success" });
    return { runId: dbg.collector.runId, text: result.text, status: "success" };
  } catch (err) {
    await dbg.finish({ status: "error", error: err });
    return {
      runId: dbg.collector.runId,
      text: err instanceof Error ? err.message : String(err),
      status: "error",
    };
  }
}
