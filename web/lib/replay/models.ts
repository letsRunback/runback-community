/**
 * Models offered for replay — a pure constant with no server imports, so both
 * server code (runStep, the eval route) and client UI (replay panel, eval form)
 * can share one source of truth.
 *
 * llama-3.3 intermittently malforms tool calls with the AI SDK on Groq, so it
 * isn't a default anywhere — but it stays available for exact-fidelity replays.
 */
export const REPLAY_MODELS = [
  // Groq-hosted
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3-32b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  // OpenAI (needs OPENAI_API_KEY on the server)
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  // Anthropic (needs ANTHROPIC_API_KEY on the server)
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];
