/**
 * Shared gate token for the private exec deck. The cookie holds a hash derived
 * from EXEC_PASSWORD — never the password itself — so middleware can verify it at
 * the edge without a round-trip, and the password only ever lives server-side.
 * Uses Web Crypto so it runs in both the edge middleware and the node route.
 */
export const EXEC_COOKIE = "exec_gate";

export async function execToken(password: string): Promise<string> {
  const data = new TextEncoder().encode("runback-exec:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
