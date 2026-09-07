# Cold email — banks / financial institutions

**Target roles:** Chief Risk Officer, Head of AI Risk, Group Technology Risk, Chief Compliance Officer, Head of Model Risk Management

**Research before sending:** Look for recent APRA/ASIC announcements, CPS 230 remediation updates, or AI deployment news from the target bank. Drop the specific reference in the first line.

---

## Email 1 — The hook (send first)

**Subject:** CPS 230 and your AI agents — one gap

Hi [Name],

[ANZ/CBA/NAB] recently published [specific CPS 230 update / AI deployment announcement / specific news]. The operational incident recording requirement in §45 is straightforward for traditional systems. For AI agents, it's not — because reproducing what an agent decided requires more than a log.

Most financial institutions we speak with have the same gap: when an agent makes a consequential decision (loan approval, fraud flag, payment routing), the trace records the outcome but not the exact context the model saw. A regulator asking to reproduce the decision 18 months later gets "we no longer have that."

We built Runback specifically for this. Every agent decision is sealed into a re-executable cassette — the retrieved documents, tool outputs, model version, and full messages[] array. One click to replay the exact context. One export for the examiner.

Would a 20-minute call make sense? I can walk you through the CPS 230 control mapping and show a live replay of a loan-approval scenario.

[Name]
runback.dev/enterprise

---

## Email 2 — Follow-up (send 5 days later if no reply)

**Subject:** Re: CPS 230 and your AI agents

Hi [Name],

Following up briefly — happy to share the APRA CPS 230 control mapping document if that's easier than a call. It maps the §45 and §48 requirements directly to what Runback captures and what evidence it produces.

Self-hosted in your own VPC, so the trace data never reaches us. If the timing isn't right, I'll leave it there.

[Name]

---

## Email 3 — Last touch (send 7 days after email 2)

**Subject:** Last note — CPS 230 documentation

Hi [Name],

Last note on this. If CPS 230 operational incident recording for AI systems lands on your team's roadmap, runback.dev/procurement has the full control mapping, CAIQ, and DPA pre-filled — it's designed to shortcut the vendor assessment process.

Happy to join your security review whenever the timing works.

[Name]

---

## Personalisation notes

- ANZ specifically: APRA released a CPS 230 implementation update in 2025. Reference it.
- Commonwealth Bank: They've publicly discussed AI agent deployment in lending. Good hook.
- For international: swap "CPS 230" for "EU AI Act Art. 12" or "NIST AI RMF Govern 1.7" depending on jurisdiction.
- For law firms who use this email: swap the hook to "professional conduct obligations and AI supervision."

## Tracking

Send from your personal email, not a bulk tool. Reply rates on personal sends to a named CRO are 10–20%. Bulk tools get <1%.
