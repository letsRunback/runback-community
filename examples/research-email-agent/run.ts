import "dotenv/config";
import { runAgent } from "./agent.js";

// Default task includes a DELIBERATELY MALFORMED address ("jordan[at]example.com")
// so the run fails at send_email — giving Runback something to debug.
const task =
  process.argv.slice(2).join(" ") ||
  "Research Next.js 16 and email a 3-sentence summary to jordan[at]example.com";

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("Missing GROQ_API_KEY. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  console.log(`\n▶ Running agent on task:\n  "${task}"\n`);
  const result = await runAgent(task);

  const base = (process.env.RUNBACK_INGEST_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  console.log(`\n${result.status === "success" ? "✓" : "✗"} Run ${result.status}`);
  console.log(`  ${result.text}\n`);
  console.log(`🔍 Open in Runback:\n  ${base}/runs/${result.runId}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
