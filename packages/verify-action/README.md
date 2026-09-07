# Runback Verify (GitHub Action)

A thin composite-action wrapper around [`@runback/verify`](https://www.npmjs.com/package/@runback/verify) —
checks the tamper-evidence and signature of a `runback.cassette/v1` audit
record in CI, so a broken or unsigned export fails the build instead of
being noticed later. No account, no API key.

## Usage

```yaml
- uses: letsRunback/runback-verify-action@v1   # NOT YET PUBLISHED — see "Publishing" below
  with:
    path: "audit-exports/**/*.json"
```

### Inputs

| Input                | Required | Default | Description |
|-----------------------|----------|---------|--------------|
| `path`                | yes      | —       | Glob matching one or more cassette/narrative/finding JSON files. |
| `key`                 | no       | —       | HMAC signing key, for legacy HMAC-signed records only. Pass via a secret. |
| `version`             | no       | `2`     | `@runback/verify` npm dist-tag or exact version to install. |
| `fail-on-unverified`  | no       | `true`  | Fail the step on a self-consistent-but-unsigned/unpinned record (exit 2), not just a broken one (exit 1). |

### Outputs

| Output    | Description |
|-----------|-------------|
| `verdict` | Worst verdict across all matched files: `invalid` \| `unverified` \| `valid`. |
| `checked` | Number of files verified. |

## Why this exists

`npx @runback/verify` already runs anywhere with no account. This wraps it in
a composite action for the one thing a raw CLI can't do on its own: fail a
GitHub Actions run and surface an annotation inline on the PR, so tamper
detection is a CI gate a team can require, not a command someone has to
remember to run.

## Publishing (maintainer notes)

This source lives inside the main `stepback` monorepo for development, but a
GitHub Marketplace listing requires `action.yml` at the **root** of its own
public repository. To publish:

1. Copy `action.yml`, `verify.sh`, and this `README.md` to the root of the
   public `letsRunback/runback-verify-action` repo (or push this directory's
   contents there via `git subtree split`/`git filter-repo` to preserve
   history).
2. Enable **Settings → General → Features → Dependency graph** on that repo
   and on `letsRunback/runback-proofs` (the `@runback/verify` source) — this
   is what makes GitHub's "Used by N repositories" surface work, and is a
   one-time settings toggle, not something a CI job can do.
3. Tag a release (`v1`, `v1.0.0`) and follow GitHub's own
   ["Publish an action to the Marketplace"](https://docs.github.com/en/actions/creating-actions/publishing-actions-in-github-marketplace)
   flow to list it. GitHub asks for a Marketplace category and a signed-in
   maintainer to click through the listing form — no CLI path exists for
   this step.
4. Once published, link it from `/verify` and `/docs` on the marketing site.
