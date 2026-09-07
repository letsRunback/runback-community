# External witnessing

Status: **shipped for checkpoints.** Every sealed checkpoint is time-stamped by
independent RFC 3161 authorities, and the raw tokens are downloadable and
verifiable with `openssl` alone.

## The gap this closes

Until now the ledger was self-attested. Runback signs each checkpoint with
`AUDIT_SIGNING_KEY`, and Runback holds that key. So every check in the system
answered *"did someone else alter this?"* and none answered *"did the operator
alter this?"* — which is the first question an auditor asks about an evidence
product, and "trust us" is not an answer to it.

A free competitor (`halo-record`) already anchored to external witnesses. We did
not. This closes that.

## What it does

On seal, the checkpoint imprint — `sha256(org_id:seq:head_hash:merkle_root)` —
is sent to two independent Time-Stamp Authorities. Each returns a token signed
with a certificate we do not control, attesting that this exact head existed at
that time.

Rewriting history changes the head, which changes the imprint. The stored tokens
no longer attest it, and a replacement token can only carry the time it was
actually issued. **Backdating is the thing a TSA exists to prevent.**

Verified end to end against `freetsa.org` and DigiCert:

```
SEAL checkpoint seq=5 → witnesses: freetsa.org, digicert
  openssl says both signed:  66bfa5b2…  at Aug 2 13:18:33 2026 GMT
  original head imprint:     66bfa5b2…  ✓ matches
  rewritten head imprint:    1d6db07f…  ✗ no token attests this
```

## Verifying without us

That is the point — an auditor should not need our verifier:

```bash
# 1. what the authority actually signed
openssl ts -reply -in runback-checkpoint-4-freetsa.org.tsr -token_in -text

# 2. confirm "Message data" equals sha256("<org>:<seq>:<head>:<root>")
#    (the API returns expectedImprint so you can compare, not take our word)

# 3. verify the authority's own signature against its CA
openssl ts -verify -in <file>.tsr -token_in -data <imprint> -CAfile <tsa-ca.pem>
```

`GET /api/app/ledger/witness?seq=N` lists receipts and whether each token's
imprint matches the checkpoint. `&download=1` returns the token **verbatim** —
re-encoding it would mean the bytes an auditor checks are bytes we produced.

## What this does NOT prove

Stated plainly, because an over-claimed control is worse than a missing one:

- **It does not prove a single history.** A timestamp says "this head existed by
  this time". It does not prevent us sealing *two* divergent chains and
  timestamping both. Catching that needs a public append-only log where all
  submissions are visible — Sigstore Rekor, or a published checkpoint feed.
  That is the next step and it is not done.
- **It does not prove the content is true**, only that it is unchanged since the
  timestamp. Garbage sealed honestly is still garbage.
- **It depends on the TSAs.** Two independent authorities is better than one and
  worse than a transparency log. If both were compromised *and* we were the
  attacker, this fails.
- **Unwitnessed checkpoints exist.** Sealing never fails because a third-party
  server is down, so a checkpoint can be self-attested only. `verifyLedger`
  reports this in the note rather than letting the two cases look identical.

## Configuration

`RUNBACK_TSA_URLS` — comma-separated, overrides the defaults. Any RFC 3161
authority works, including an internal one, which is what an air-gapped
deployment needs.

## The public transparency log — shipped

`GET /api/transparency` publishes every sealed checkpoint: an opaque
per-workspace id, the checkpoint sequence, and two hashes. Nothing reversible,
no run content, no customer names.

This is what upgrades "cannot backdate" to **cannot equivocate**. A timestamp
cannot stop us keeping two divergent chains and honestly stamping both. One
public feed makes that visible, and a `UNIQUE (log_id, ckpt_seq)` constraint
means the second, different head cannot even be inserted quietly.

Verified against Postgres — the equivocating insert is refused:

    publish ckpt 2 (head B)             published
    publish ckpt 2 (head B-FORGED)      ERROR: duplicate key ... log_id_ckpt_seq_key
    feed contents                       headB only; forged head absent

**`seq` may contain gaps, and that is expected.** It is a Postgres sequence, so
a rejected insert — including the refusal above — still consumes a value.
Completeness is proven by `prev_hash` linkage, not by contiguous numbering:
each entry's `prev_hash` equals the previous entry's `entry_hash`, so removing
an entry breaks the chain. Check `chain_ok`. This is stated in the API response
too, because the alternative is a reader concluding an entry was deleted.

The feed's own chain is re-derivable in any language:

    entry_hash = sha256(prev_hash + RFC8785({ckpt_seq, head_hash, log_id, merkle_root}))

## Next

1. **Sigstore Rekor v2** submission alongside the TSAs, so the anchor is in a
   log with an established witness network rather than only ours.
2. **Witness cosigning** of the feed head, so its own chain is attested by
   someone other than us — currently the feed proves we did not rewrite it only
   to an observer who archived an earlier copy.
