/**
 * Checked reads. The mirror of `write.ts`, for the other half of the same bug.
 *
 * Why this exists
 * ---------------
 * `write.ts` fixed writes that reported success without happening. Reads have
 * the identical failure mode and it is, if anything, harder to see: PostgREST
 * answers a query against a column that does not exist with HTTP 400 and
 * `{ data: null, error }`. Nearly 200 call sites here destructure
 * `const { data }` and never look at `error`, so a wrong column name does not
 * throw — it returns nothing, and "nothing" is indistinguishable from "this org
 * has no data yet".
 *
 * Four features shipped broken for months on exactly this:
 *
 *   • `ad_runs.agent` / `.model_id` (neither exists) → the chargeback cron's
 *     query 400'd, `runs` came back undefined, the loop `continue`d, and
 *     ad_chargeback stayed empty forever. Cost attribution never produced a
 *     single number.
 *   • `ad_policies.enabled` and `ad_ledger.ts` (neither exists) → the regulatory
 *     dashboard counted 0 and reported EU AI Act Art.12 and the ledger control
 *     as "not_started" to customers whose policies and ledger were live.
 *   • `runs` (the table is `ad_runs`) → the PLG cron's 100-run milestone email
 *     has never fired for anyone.
 *   • `ad_policy_causes.cause_type` (the column is `policy_name`) → the weekly
 *     newsletter's fleet signal silently fell back to canned marketing copy.
 *
 * Every one rendered as an empty state. That is the point: a read that failed
 * must never be mistaken for a read that found nothing.
 *
 * Usage
 * -----
 *   const rows = await mustRead(
 *     sb.from("ad_runs").select("run_id,name").eq("org_id", orgId),
 *     "load org runs"
 *   );
 *
 *   // Where an empty result genuinely is an acceptable outcome — a dashboard
 *   // panel that should degrade rather than 500 the whole page:
 *   const rows = await tryRead(sb.from("ad_teams").select("*"), "load teams", []);
 *
 * `tryRead` still logs, and takes the fallback explicitly so the degraded value
 * is a decision in the source rather than an accident of destructuring.
 */

/** The shape every supabase-js query builder resolves to. */
interface PostgrestResultLike<T> {
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  data: T | null;
}

export class DbReadError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
    message: string
  ) {
    super(`${operation} failed: ${message}${code ? ` (${code})` : ""}`);
    this.name = "DbReadError";
  }
}

/**
 * Await a read and THROW if the database rejected it.
 *
 * Use wherever an empty result would be interpreted as a fact about the data —
 * a compliance status, a usage count, a billing rollup, a gate decision. A 500
 * is a much better outcome than confidently telling a customer they have no
 * policies when the query was simply malformed.
 */
export async function mustRead<T>(
  query: PromiseLike<PostgrestResultLike<T>>,
  operation: string
): Promise<T> {
  const res = await query;
  if (res.error) {
    console.error(`[db] ${operation} failed:`, res.error.message, res.error.details ?? "");
    throw new DbReadError(operation, res.error.code, res.error.message);
  }
  return res.data as T;
}

/**
 * Await a read, log loudly on failure, and fall back to an explicit value.
 *
 * Only for reads whose absence genuinely degrades gracefully — an optional
 * dashboard panel, a nice-to-have enrichment. The fallback is a required
 * argument on purpose: it makes the degraded state visible in the code instead
 * of hiding it behind `?? []`.
 */
export async function tryRead<T>(
  query: PromiseLike<PostgrestResultLike<T>>,
  operation: string,
  fallback: T
): Promise<T> {
  const res = await query;
  if (res.error) {
    console.error(`[db] ${operation} failed (non-fatal):`, res.error.message, res.error.details ?? "");
    return fallback;
  }
  return (res.data ?? fallback) as T;
}

/**
 * Await a `{ count }` query (`.select("col", { count: "exact", head: true })`)
 * and THROW if it was rejected.
 *
 * Counts are the sharpest version of this bug: a failed count reads as `null`,
 * every call site coalesces it to `0`, and `0` is a legitimate-looking answer
 * that silently drives a threshold the wrong way. Both regulatory-dashboard
 * bugs were exactly this.
 */
export async function mustCount(
  query: PromiseLike<{ error: PostgrestResultLike<unknown>["error"]; count: number | null }>,
  operation: string
): Promise<number> {
  const res = await query;
  if (res.error) {
    console.error(`[db] ${operation} failed:`, res.error.message, res.error.details ?? "");
    throw new DbReadError(operation, res.error.code, res.error.message);
  }
  return res.count ?? 0;
}

/**
 * Read EVERY row a query matches, by paging — never a silently truncated prefix.
 *
 * Why this is a correctness bug and not a performance one
 * ------------------------------------------------------
 * PostgREST caps how many rows one request returns (`db-max-rows`; Supabase
 * has historically defaulted to 1000). A query with no `.limit()` does not
 * fail when it exceeds that — it returns the cap, with no marker saying it was
 * cut short. Aggregate code then sums a prefix and reports the total.
 *
 * For most products that is a wrong dashboard number. Here it is worse: the
 * same pattern feeds the compliance report, the cost attribution a customer
 * bills teams from, and the regulatory evidence they hand an auditor. A
 * truncated read does not produce a visibly broken page — it produces a
 * confident, precise, wrong number in the one artifact whose entire value is
 * being trustworthy. "We under-reported policy blocks because our HTTP client
 * paginates" is not a survivable sentence in an audit.
 *
 * So: page explicitly, and refuse to guess. The page size is ours, so the loop
 * is correct regardless of the server's cap. If the result set exceeds `max`,
 * this THROWS rather than returning a prefix — a caller that genuinely wants
 * the newest N rows should say so with `.limit()`, which is then a decision in
 * the source rather than an accident of the transport.
 */
export async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<PostgrestResultLike<T[]>>,
  operation: string,
  opts: { pageSize?: number; max?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const max = opts.max ?? 100_000;
  const out: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const res = await build(from, from + pageSize - 1);
    if (res.error) {
      console.error(`[db] ${operation} failed:`, res.error.message, res.error.details ?? "");
      throw new DbReadError(operation, res.error.code, res.error.message);
    }
    const page = res.data ?? [];
    out.push(...page);

    // Short page → the end. Equal to pageSize → there may be more.
    if (page.length < pageSize) return out;

    if (out.length >= max) {
      throw new DbReadError(
        operation,
        "TOO_MANY_ROWS",
        `${operation} matched more than ${max} rows. Refusing to return a partial result, ` +
          `because a truncated read here becomes a wrong number in a report someone relies on. ` +
          `Narrow the query (time window or org) or aggregate in the database.`
      );
    }
  }
}
