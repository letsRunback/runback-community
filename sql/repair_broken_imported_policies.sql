-- Migration 86 (sql/fix_policy_template_shape.sql) cleared the pre-fix,
-- fictional-shape rows out of the *catalog* (ad_policy_templates). It could
-- not touch ad_policies: any org that had already clicked "Import" on one of
-- the original 8 broken templates before that fix landed kept its own copy
-- of the old shape ({type, tool/pattern, condition/message} instead of the
-- real engine's {id, kind, pred/when+then} — see packages/policy/src/index.ts)
-- sitting live in its policy set. Confirmed in production: a demo org's
-- imported "Loan amount ceiling" still held the old shape and crashed
-- coverage-gap analysis and anomaly flagging (toolsCoveredByRules threw on
-- the undefined .op) the moment either feature tried to read it — and would
-- equally crash "Simulate against history" and the CI eval gate the moment
-- that policy was evaluated (evalPredicate has the same undefined-.op crash;
-- lib/eval/policyCoverage.ts now guards against it defensively going
-- forward, but this migration fixes the data at rest so evaluation works too,
-- not just coverage/anomaly reads).
--
-- Repairs the 5 templates that have an honest equivalent in the real DSL
-- (matched by the old shape's distinctive {type, tool/pattern} combination —
-- see policyLibrary.ts's BUILTINS for the corrected rules this reproduces
-- exactly) by rewriting the old rule object in place. The 3 templates
-- removed outright in that fix (Token budget hard cap, Escalation loop
-- breaker, Content safety classifier) have no honest replacement — a rule
-- matching their old shape, or any other unrecognized {type: ...} rule, is
-- dropped rather than faked. That is not a reduction in real protection: an
-- unparseable rule already provided none (fail-open at runtime, hard crash
-- in simulation/CI-gate) — dropping it just stops it from being reported as
-- if it were live. A policy that loses its only rule this way keeps its row
-- (name, version, history) with an empty rules array; nothing here deletes a
-- policy or touches one that's already in the real shape.
DO $$
DECLARE
  pol RECORD;
  new_rules jsonb;
  rule jsonb;
BEGIN
  FOR pol IN
    SELECT id, rules FROM ad_policies
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(rules) r WHERE r ? 'type' AND NOT r ? 'kind'
    )
  LOOP
    new_rules := '[]'::jsonb;
    FOR rule IN SELECT * FROM jsonb_array_elements(pol.rules) LOOP
      IF rule ? 'kind' THEN
        -- Already the real shape — untouched.
        new_rules := new_rules || jsonb_build_array(rule);

      ELSIF rule->>'type' = 'tool_block' AND rule->>'tool' = 'issue_approval' THEN
        new_rules := new_rules || jsonb_build_array(jsonb_build_object(
          'id', 'loan-amount-ceiling', 'kind', 'assert',
          'description', 'issue_approval blocked above the configured ceiling',
          'pred', jsonb_build_object('op', 'not', 'pred', jsonb_build_object(
            'op', 'tool_arg', 'tool', 'issue_approval', 'path', 'amount', 'cmp', 'gt', 'value', 50000
          ))
        ));

      ELSIF rule->>'type' = 'output_block' AND rule->>'pattern' ILIKE '%ssn%' THEN
        new_rules := new_rules || jsonb_build_array(jsonb_build_object(
          'id', 'pii-data-minimisation', 'kind', 'assert',
          'description', 'No PII pattern in the model''s output text',
          'pred', jsonb_build_object('op', 'not', 'pred', jsonb_build_object(
            'op', 'output_matches', 'pattern', 'ssn|social_security|card_number|date_of_birth', 'flags', 'i'
          ))
        ));

      ELSIF rule->>'type' = 'tool_block' AND rule->>'tool' = 'update_customer' THEN
        new_rules := new_rules || jsonb_build_array(jsonb_build_object(
          'id', 'customer-write-justification', 'kind', 'assert',
          'description', 'update_customer requires a non-empty justification',
          'pred', jsonb_build_object('op', 'not', 'pred', jsonb_build_object(
            'op', 'and', 'all', jsonb_build_array(
              jsonb_build_object('op', 'tool_called', 'tool', 'update_customer'),
              jsonb_build_object('op', 'tool_arg', 'tool', 'update_customer', 'path', 'justification', 'cmp', 'eq', 'value', '')
            )
          ))
        ));

      ELSIF rule->>'type' = 'input_block' AND rule->>'pattern' ILIKE '%ignore%' THEN
        new_rules := new_rules || jsonb_build_array(jsonb_build_object(
          'id', 'prompt-injection-detection', 'kind', 'assert',
          'description', 'No known injection pattern in the input text',
          'pred', jsonb_build_object('op', 'not', 'pred', jsonb_build_object(
            'op', 'input_matches', 'pattern', 'ignore (all|previous|above)|you are now|system: override|<\|im_start\|>', 'flags', 'i'
          ))
        ));

      ELSIF rule->>'type' = 'tool_block' AND rule->>'tool' LIKE '%decision%' THEN
        new_rules := new_rules || jsonb_build_array(jsonb_build_object(
          'id', 'eu-ai-act-human-in-loop', 'kind', 'assert',
          'description', 'reject_application requires human_confirmed: true',
          'pred', jsonb_build_object('op', 'not', 'pred', jsonb_build_object(
            'op', 'and', 'all', jsonb_build_array(
              jsonb_build_object('op', 'tool_called', 'tool', 'reject_application'),
              jsonb_build_object('op', 'tool_arg', 'tool', 'reject_application', 'path', 'human_confirmed', 'cmp', 'ne', 'value', true)
            )
          ))
        ));

      ELSE
        -- Token budget hard cap / Escalation loop breaker / Content safety
        -- classifier / any other unrecognized old-shape rule — dropped, see
        -- comment above.
        NULL;
      END IF;
    END LOOP;
    UPDATE ad_policies SET rules = new_rules WHERE id = pol.id;
  END LOOP;
END $$;
