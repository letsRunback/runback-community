/**
 * Refuse to start against an expired Supabase JWT.
 *
 * A self-hosted deployment whose token has lapsed fails in the worst possible
 * way: PostgREST answers 401 (PGRST301) to every query, so login is impossible
 * and the only clue is "JWT expired" buried in a server log behind a generic
 * 500. Nothing else about the deployment looks wrong — the site serves, the
 * database is healthy, the containers are up. This cost real time to diagnose
 * on a stack that was otherwise correctly configured, and a self-hoster hitting
 * it has far less to go on than we did.
 *
 * .env.example's recipe mints tokens with a 100-year expiry precisely so this
 * cannot happen, but nothing verified that the token in use followed it. Now
 * something does, once, at client construction, naming the fix.
 *
 * Deliberately does NOT verify the signature — that needs the secret and is
 * PostgREST's job. This reads only the unverified `exp` claim, to turn a
 * silent, misleading failure into an explicit one. A malformed or non-JWT key
 * is left alone: hosted Supabase issues key formats this cannot parse, and
 * refusing to boot over a format we do not recognise would be worse than the
 * bug being guarded against.
 */
export function assertNotExpired(varName: string, key: string): void {
  const parts = key.split(".");
  if (parts.length !== 3) return; // not a JWT we can read — not our call to judge
  let exp: unknown;
  try {
    const pad = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    exp = (JSON.parse(Buffer.from(pad, "base64url").toString()) as { exp?: unknown }).exp;
  } catch {
    return; // unparseable payload — same reasoning as above
  }
  if (typeof exp !== "number") return;
  const secondsPast = Math.floor(Date.now() / 1000) - exp;
  if (secondsPast <= 0) return;
  throw new Error(
    `${varName} expired ${Math.floor(secondsPast / 86400)} day(s) ago. ` +
      "Every database query made with it fails 401 (PGRST301). " +
      "Mint a new token with the command in .env.example — it uses a 100-year " +
      "expiry — then restart. This is a configuration error, not a bug in Runback."
  );
}
