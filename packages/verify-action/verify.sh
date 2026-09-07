#!/usr/bin/env bash
# Runs inside the composite action defined in action.yml. Not meant to be
# invoked directly — see that file for the inputs it reads from the
# environment (RB_PATH_GLOB, RB_KEY, RB_VERSION, RB_FAIL_ON_UNVERIFIED).
set -uo pipefail
shopt -s nullglob
shopt -s globstar 2>/dev/null || true # unsupported on bash <4 (e.g. macOS system bash); ** just won't recurse there

files=( $RB_PATH_GLOB )
if [ "${#files[@]}" -eq 0 ]; then
  echo "::error::No files matched pattern '$RB_PATH_GLOB'"
  exit 1
fi

# Verdict severity, worst wins: invalid > unverified > valid.
rank() { case "$1" in invalid) echo 2 ;; unverified) echo 1 ;; *) echo 0 ;; esac; }

worst="valid"
any_invalid=0
checked=0

for f in "${files[@]}"; do
  echo "::group::Verifying $f"
  out="$(mktemp)"
  if [ -n "${RB_KEY:-}" ]; then
    npx --yes "@runback/verify@${RB_VERSION:-2}" "$f" --key "$RB_KEY" --json > "$out" 2>&1
  else
    npx --yes "@runback/verify@${RB_VERSION:-2}" "$f" --json > "$out" 2>&1
  fi
  code=$?
  checked=$((checked + 1))

  verdict="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).verdict||'invalid')}catch{console.log('invalid')}")"
  cat "$out"
  echo "verdict: $verdict (exit $code)"
  echo "::endgroup::"

  if [ "$(rank "$verdict")" -gt "$(rank "$worst")" ]; then
    worst="$verdict"
  fi
  if [ "$verdict" = "invalid" ]; then
    any_invalid=1
  fi
done

echo "verdict=$worst" >> "$GITHUB_OUTPUT"
echo "checked=$checked" >> "$GITHUB_OUTPUT"

if [ "$any_invalid" -eq 1 ]; then
  echo "::error::One or more records failed integrity verification (verdict: invalid)"
  exit 1
fi
if [ "$worst" = "unverified" ] && [ "${RB_FAIL_ON_UNVERIFIED:-true}" = "true" ]; then
  echo "::error::One or more records are self-consistent but unsigned or unpinned (verdict: unverified). Set fail-on-unverified: 'false' to allow this."
  exit 1
fi

echo "All $checked file(s) verified: $worst"
