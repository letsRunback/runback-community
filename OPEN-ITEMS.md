# Open items

Decisions deliberately deferred, with enough context to act on without
re-deriving them. Each says what was decided, why it was deferred, and what
triggers a revisit.

---

## 7. Left over from the QA remediation (2 Aug 2026)

Four QA reviewers went through the platform end to end; everything they found
was fixed except the items below, which need a decision or an action rather
than a patch.

### Demo workspace — RESEEDED (2 Aug 2026)

`/app/runs` advertised "a caught policy breach" while `/app/compliance` reported
0 policies, 0 evaluations, 0 blocks. The compliance page was right, and a plain
reseed would NOT have fixed it: `scripts/seed-demo.ts` described the block in
prose and never wrote `policy_block` or `policy_evaluated`, which are the fields
ingest derives `policy_blocked` from and the RPC counts.

The curated seed now carries them — one block plus three passing evaluations —
along with the policy the block is attributed to (previously "active policies 0"
sat beside a block enforced by a rule that did not exist). Cleanup also changed
from matching fixed prefixes to removing anything not in the curated set, so
visitors' runs no longer accumulate on top of the story.

Now shows: 3 runs · 1 active policy · 4 calls evaluated · 1 block, attributed to
`escalate-large-disputed`. Ledger intact at 5 entries, prior runs tombstoned as
`seed-reset`.

Fixed a hazard found by running it: with neither `--org` nor a matching demo
email, org resolution fell through to "whichever api_key has an org" and began
deleting in an unrelated workspace. Nothing was lost — it was empty, and the
tenancy guard then refused the write — but the script now prefers
`RUNBACK_SHOWCASE_ORG` and refuses rather than guessing.

**Still open:** `/app/cost` renders a hard-coded sample report rather than live
data, which is why it shows 3 runs where the overview shows a different number.

### Row-level security — partially done, the boundary is not yet the database

**Done (2 Aug 2026).** RLS is enabled on every table, and the anon/authenticated
roles are revoked across the whole schema with default privileges flipped so a
new table is closed on creation. Verified in production: anon now gets `401`
everywhere (it previously got `200 []` — reachable, and empty only because a
policy said so). Migrations: `sql/enable_rls_everywhere.sql`,
`sql/revoke_anon_everywhere.sql`. A CI guard fails when a new table ships
without RLS; it found `newsletter_subscribers`, which the review had missed.

**Not done, deliberately.** There are still no org-predicated policies, because
they would have no effect: the application connects as `service_role`, which has
`BYPASSRLS`. Writing `USING (org_id = ...)` today produces a control that never
evaluates — the schema would look isolated and behave exactly as before, which
is worse than the honest gap because the next reader believes it. A test fails
if such a policy appears without the mechanism behind it.

So tenant isolation still rests on application-layer filtering plus two
source-level CI guards. That is one layer, and this codebase has already shipped
three separate missing-filter bugs, each of which type-checked and passed the
suite.

**The remaining work** — org-scoped JWT, a `tenant` role without `BYPASSRLS`,
policies keyed on the claim, per-module migration of reads off the admin client,
with a kill switch — is specified in `docs/RLS-PLAN.md`. Roughly 3–5 days for
the mechanism plus the three highest-value modules. After it, a call site that
forgets `.eq("org_id", ...)` returns zero rows instead of everyone's.

**Trigger:** the first enterprise security review that asks how isolation
survives an application bug.

### Blog posts all share one date

All six are dated 2026-07-14, which reads as a bulk import rather than a
publication history. Cosmetic, but it undercuts the "reviewed quarterly" claim
elsewhere on the site.

### Not defects — recorded so they are not "re-fixed"

- **Header CTA contrast.** Reported as 2.78:1 and unreadable. It is
  `#0a0b0d` on `#f0f0f8` — about 19:1, the highest-contrast element on the
  page. The reviewer measured an inherited value, not the button.
- **Replay slider off-by-one.** The control is 0-indexed and the label is
  1-indexed; both are correct. Only the screen-reader announcement was wrong,
  and that now has `aria-valuetext`.
- **Ingest rate limiting.** Reported missing; it is 300/min pre-auth and
  1000/min per org. Forty test requests never reached the threshold.
- **`/signup` 404.** Real, but nothing anywhere links to it.

---

## 0. Show HN — BLOCKED by account standing, not by readiness

Attempted Sun 2 Aug, 10:01am ET. HN refused the submission and redirected to
/showlim: Show HNs are restricted for new accounts. `Runback_Founder` has
**1 karma**, and `/submitted?id=runback` is empty — nothing posted.

The post itself is finished and pre-flighted; every command in it was run
against live production immediately beforehand and produced the documented
output.

**Do not route around the restriction.** Dropping the "Show HN:" prefix evades a
moderation rule, and posting the product as a plain link without that disclosure
is worse conduct. Either risks runback.dev permanently for one post.

**Next:** email hn@ycombinator.com — moderators routinely lift this for someone
with a real artifact to show. Failing that, earn standing by commenting
substantively for a couple of weeks, which is exactly what the notice asks for.
Full detail and alternative channels in `launch/show-hn-post.md`.

**Still true:** do not post more than two or three times a year. HN bans domains
for repeated self-promotion.

---

## 1. USD Lemon Squeezy store — IN PROGRESS, blocked on review

**Status:** a USD store has been created in the same Lemon Squeezy account and
is **under review**. Its products are not API-visible until approved, so the
cutover cannot happen yet.

    store    444042
    starter  1973996
    growth   1973988
    scale    1973993
    pro      1973991

Run `scripts/check-usd-store.mjs` to test readiness — it verifies the store
resolves, that its currency really is USD, and that every product is
*published* rather than draft. A draft product still mints a checkout URL but
cannot complete a purchase, so the failure would land on the customer.

Do **not** set the env vars before it reports READY: pointing checkout at
variants that 404 is strictly worse than the current AUD pricing, which at
least completes a sale.

**Interim:** prices are quoted in A$ across the site and in structured data,
matching what is actually charged today.

### Why it is open

Currency in Lemon Squeezy is a **store-level** setting, not per-product, and it
cannot be changed through the API — `PATCH /v1/stores` and `PATCH /v1/products`
both return 405. It is dashboard-only.

The existing store (`AI Research Tools`, id 407935) is AUD and also holds eight
non-Runback products (EAAPL / AEAI / AAIRF). Switching that store to USD would
reprice all of them, which is a different business's decision.

### What it costs to leave

Headline prices are quoted in AUD to a market that is mostly US. A$49 is roughly
US$32, so the effective price is about a third below what the number implies to
an American buyer. Not wrong, just under-priced against intent.

### What to do when revisited

The store now exists, so what remains is the cutover. Update five env vars in
Vercel production:

    LEMONSQUEEZY_STORE_ID
    LEMONSQUEEZY_VARIANT_STARTER
    LEMONSQUEEZY_VARIANT_GROWTH
    LEMONSQUEEZY_VARIANT_SCALE
    LEMONSQUEEZY_VARIANT_PRO

Then revert `priceAmount` in `web/lib/plans.ts` to `$`, set `priceCurrency` back
to `USD` in `web/app/layout.tsx`, and remove the Australian-dollars note on
`web/app/pricing/page.tsx`. Re-run the checkout test across all four tiers and
the webhook lifecycle afterwards.

One step is easy to miss: **webhooks are per-store**, so the new store has none
and the old store's does not carry over. Without it a customer pays and their
plan never upgrades — the exact failure the webhook lifecycle testing was done
to rule out. Create it in the new store pointing at
`https://runback.dev/api/billing/webhook` for `subscription_created`,
`subscription_updated` and `subscription_expired`, then replace
`LEMONSQUEEZY_WEBHOOK_SECRET`.

**Trigger:** as soon as review clears. `total_sales` is 0 today, so the switch
is free; it stops being free the moment someone subscribes, because existing
subscriptions do not migrate between stores.

---

## 2. SOC 2 Type II and ISO 42001

**Status:** not started. Needs money, not code.

Gates enterprise procurement regardless of product quality, and takes 3–6
months. `/security` carries an honest control map covering eleven SOC 2 criteria
against shipped mechanisms, which is the interim answer and also the preparation
that makes the audit cheaper.

**Trigger:** as soon as there is revenue to fund it. The clock is the constraint,
so starting late costs more than the fee.

---

## 3. A real card purchase has never run

Checkout creation, the full webhook lifecycle (created → updated → cancelled →
expired), unknown-variant rejection and signature forgery are all verified
against production using signed payloads.

What has **not** run is Lemon Squeezy's own hosted checkout with a real card.
Test mode is not configured — every product reports `test_mode=false` — so this
needs either test-mode setup in the dashboard or a live purchase and refund.

**Trigger:** before the first customer buys, so they are not the one who finds
out.

---

## 4. `ad_events` is unpartitioned — now self-monitoring

Fine at current volume (19 rows). Becomes a problem around 10M, where index
maintenance and the retention sweep start to degrade.

Indexes are in place and every read is bounded, counted or paged, so this is a
scaling task rather than a correctness one — and doing it now would be building
for a load that does not exist.

**The trigger no longer depends on anyone remembering.** `checkCapacity()` runs
daily on the uptime cron and raises a tracked fault once `ad_events` passes 5M
rows. It goes through the error tracker rather than its own alert, so it is
deduplicated by fingerprint: a daily job emailing "still large" forever is how
a real warning ends up filtered. Verified — three runs produce one fault group
with three occurrences, i.e. one notification.

**Trigger:** the capacity fault arriving in the error digest. Partition by month
or archive at that point.

---

## 5. `RUNBACK_DEMO_EMAILS` — RESOLVED

The variable was set to an unknown, masked value that did not resolve to
`demo@runback.dev`, which is why `showcaseOrgId()` returned null until
`RUNBACK_SHOWCASE_ORG` was pinned.

Rather than trying to recover a value Vercel will not disclose, it was **set to
a known one**: `demo@runback.dev`. Verified in production — the demo login
returns 200, the session belongs to `demo@runback.dev`, and the showcase org
now resolves by email as well as by the pinned override.

---

## 6. `AUDIT_SIGNING_KEY_PREVIOUS` — RESOLVED

The production key was a value nobody could read, so `AUDIT_SIGNING_KEY_PREVIOUS`
could never be populated — and rotating without it makes every existing
checkpoint fail signature verification. Verification is fail-closed, so an intact
ledger would have reported as **tampered**.

**Escaped by rotating to a key we hold a copy of.** Done on 1 Aug 2026:

    accenture     intact=true  count=4   retired=4   (re-sealed at seq 4)
    runback(old)  intact=true  count=27  retired=27
    runback-demo  intact=true  count=3   retired=3
    rotate-audit-key --check → every ledger verifies

The key lives in `.secrets/audit-signing-key` (gitignored, mode 600) and in the
macOS login keychain — see `.secrets/README-audit-key.md`. The next rotation can
set `PREVIOUS` properly, which is the whole point.

### What the rotation confirmed

The self-diagnosing note was exercised by a real rotation rather than a
simulation. It correctly reported *"the chain itself is intact — every entry
re-derives… this is the signature of a rotated AUDIT_SIGNING_KEY"* instead of
accusing anyone of destroying evidence. That is the failure mode it exists for.

### One deliberate override, recorded

`rotate-audit-key.ts` refused to `--reseal` without `PREVIOUS` set. That refusal
is correct in general — re-sealing over unverifiable evidence signs away the
proof of whatever went wrong. It was overridden here because the outgoing key was
*never* recoverable, which is precisely why the rotation happened; there was no
value that could have been supplied. The old seq-3 checkpoint is still in the
table and simply cannot be verified against a key that no longer exists. Every
entry still re-derives from the chain itself, which is what carries the integrity
claim.

**Do not treat this as precedent.** Any future rotation has a readable previous
key, so the guard should be satisfied, not bypassed.

**Trigger:** any time someone plans to rotate `AUDIT_SIGNING_KEY`. Run
`scripts/rotate-audit-key.ts --check` first, and set `PREVIOUS` before touching
the live key.
