import Link from "next/link";
import { PRICING_HREF } from "@/lib/edition";

/**
 * The competitive argument: why a readable log is not a re-runnable record,
 * why the data compounds, and why the proof outlives the vendor.
 *
 * Extracted from /why when that page was retired into /how-it-works. It is a
 * component rather than copied JSX because the visuals are ~200 lines of
 * hand-built comparison markup — duplicating them would guarantee the two
 * copies drifted, and this argument is the one page element that most needs to
 * stay exact.
 */
const REASONS: { k: string; ev: string; href: string; evlabel: string; external?: boolean }[] = [
  {
    k: "You can't reproduce what your agent decided.",
    ev: "Demo scenario — walk the exact step",
    // Relative same-page anchor, not a next/link href to this same route —
    // reproduced live: a Link to the current route with a new hash landed the
    // scroll position off by ~3500px (see Header.tsx). A plain in-page anchor
    // is native browser fragment navigation, no client router involved.
    href: "#incident",
    evlabel: "walk it →",
  },
  {
    k: "You think you can build this. The parts that matter you can't.",
    ev: "Auto-mined adversarial corpus — the actual mechanism",
    href: "/docs#feat-corpus-miner",
    evlabel: "read how it works →",
  },
  {
    k: "Your agents produce decisions that outlast your current vendor.",
    ev: "Open and verify a run yourself",
    href: "/runs",
    evlabel: "open a run →",
  },
  {
    k: "An auditor will ask. A regulator will follow. You need an answer before the question arrives.",
    ev: "EU AI Act, Article 12 — read the law",
    href: "https://artificialintelligenceact.eu/article/12/",
    evlabel: "the law ↗",
    external: true,
  },
  {
    k: "You're not betting on one model forever. Your governance layer shouldn't either.",
    ev: "Why we don't compete on models",
    href: "/how-it-works",
    evlabel: "how it works →",
  },
  {
    k: "Multi-agent systems have no trust primitive. Every other tool treats that gap as out of scope.",
    ev: "Inter-agent trust chain — Enterprise",
    href: "/enterprise#trust",
    evlabel: "how delegation is signed →",
  },
  {
    k: "The team that starts capturing today has an advantage in 18 months that can't be bought.",
    ev: "Fleet benchmarks, model diff, policy library",
    href: PRICING_HREF,
    evlabel: "what's in Pro →",
  },
];

const HOOKS = [
  /* 1 */ "Logs record the outcome. Re-execution shows the reasoning — the exact context, retrieval, and messages[] the model saw. Root cause in 4m 23s, not 3h 48m.",
  /* 2 */ "The capture layer takes a sprint. The golden corpus, fleet benchmarks, and policy history take years — and can't be imported, back-filled, or bought.",
  /* 3 */ "Move models, frameworks, or vendors. The cassette stays open-format, signed, and re-executable. Your proof outlasts every software contract.",
  /* 4 */ "EU AI Act Art. 12, APRA CPS 230, NIST AI RMF — one continuous record covers all three, built from the first run, not retrofitted when the auditor asks.",
  /* 5 */ "GPT, Claude, Gemini, Llama, or your own — across LangGraph or any framework. One governance layer above every model vendor.",
  /* 6 */ "Observability records after the call. Runback seals the delegation before execution — scope, caller, and chain cryptographically proven.",
  /* 7 */ "Behavioral history only builds forward. Every month you delay is a month of data you can never recover. That gap compounds.",
];

export default function Moats() {
  const reasons = REASONS;
  return (
        <section className="mk-section">
          {/* Every other section on the site wraps its content in .mk, which is
              what supplies the max-width and the page gutter. This one did not,
              so the whole block rendered flush to the browser edge at x=0 while
              its neighbours started at x=208, and the right-hand column was
              clipped by the viewport. */}
          <div className="mk">
          <ol className="moats">
            {reasons.map((m, i) => (
              <li className="moat" key={m.k}>

                {/* Left — claim */}
                <div className="moat-claim">
                  <span className="moat-n mono">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="moat-k">{m.k}</h3>
                  <p className="moat-hook">{HOOKS[i]}</p>
                  {m.external ? (
                    <a className="moat-ev mono" href={m.href} target="_blank" rel="noopener noreferrer">
                      {m.ev} · {m.evlabel}
                    </a>
                  ) : m.href.startsWith("#") ? (
                    // Same-page anchor — plain <a>, not next/link, so the
                    // browser's native fragment navigation handles it. A Link
                    // to the current route with a new hash measured the scroll
                    // target before the page's client components finished
                    // settling layout and landed ~3500px off (see Header.tsx).
                    <a className="moat-ev mono" href={m.href}>
                      {m.ev} · {m.evlabel}
                    </a>
                  ) : (
                    <Link className="moat-ev mono" href={m.href}>
                      {m.ev} · {m.evlabel}
                    </Link>
                  )}
                </div>

                {/* Right — visual proof */}
                <div className="moat-vis">

                  {/* 1 — log wall vs exact step */}
                  {i === 0 && (
                    <div className="why-moat-mini">
                      <div className="wmm-side wmm-side-a">
                        <div className="wmm-label" data-v="bad">Without Runback · 2,400 lines</div>
                        <div className="wmm-lines">
                          <div className="wmm-line">[02:47:03] INFO  agent.run started</div>
                          <div className="wmm-line">[02:47:04] INFO  tool_call check_credit</div>
                          <div className="wmm-line" data-hi>[02:47:05] ERROR issue_approval failed</div>
                          <div className="wmm-line">… 2,397 more lines, no context</div>
                        </div>
                      </div>
                      <div className="wmm-side wmm-side-b">
                        <div className="wmm-label" data-v="good">With Runback · exact step</div>
                        <div className="wmm-lines">
                          <div className="wmm-line" data-ok>▸ agent decides  ← failure here</div>
                          <div className="wmm-line">  model: gpt-4o · 418 tok</div>
                          <div className="wmm-line">  system: loans up to $50k only</div>
                          <div className="wmm-line" data-ok>  root cause: in this block ↑</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2 — data accumulation bars */}
                  {i === 1 && (
                    <div className="why-vis-bars">
                      {([
                        ["Your org · month 1",  "12%",  "124 runs captured",   false],
                        ["Your org · month 6",  "52%",  "847 golden tests",    false],
                        ["Your org · month 12", "100%", "2,400+ auto-mined",   false],
                        ["Competitor today",    "3%",   "starts from 0",       true],
                      ] as [string, string, string, boolean][]).map(([label, w, val, comp]) => (
                        <div key={label} className={`wvb-row${comp ? " wvb-row-comp" : ""}`}>
                          <span className="mono wvb-lbl">{label}</span>
                          <div className="wvb-track"><div className="wvb-fill" style={{width: w}} /></div>
                          <span className="mono wvb-val">{val}</span>
                        </div>
                      ))}
                      <p className="mono wvb-note">Illustrative — not usage data. The mechanism (auto-mined from real prod failures, can&apos;t be imported or bought) is real; these specific numbers aren&apos;t a customer&apos;s.</p>
                    </div>
                  )}

                  {/* 3 — cassette survives vendor change */}
                  {i === 2 && (
                    <div className="hiw-audit-card">
                      <div className="hiw-audit-row"><span className="mono k">$schema</span><span className="mono v">runback.cassette/v1</span></div>
                      <div className="hiw-audit-row"><span className="mono k">run_id</span><span className="mono v">loan-approval-agent</span></div>
                      <div className="hiw-audit-row"><span className="mono k">model</span><span className="mono v"><span className="why-struck">gpt-4o</span> → claude-4 <span className="hiw-audit-sig">✓</span></span></div>
                      <div className="hiw-audit-row"><span className="mono k">signature</span><span className="mono v">Ed25519 <span className="hiw-audit-sig">✓ still valid</span></span></div>
                      <div className="hiw-audit-foot mono">vendor changed · cassette unchanged · still verifiable</div>
                    </div>
                  )}

                  {/* 4 — three regulations, one record */}
                  {i === 3 && (
                    <div className="why-regs">
                      {([
                        ["EU AI Act · Art. 12",  "mandatory logging for high-risk AI",    "brand"],
                        ["APRA CPS 230",         "operational incident recording",         "brand2"],
                        ["NIST AI RMF",          "measure, manage, govern functions",      "brand"],
                      ] as [string, string, string][]).map(([reg, req, tone]) => (
                        <div key={reg} className="why-reg">
                          <span className="why-reg-nm" data-tone={tone}>{reg}</span>
                          <span className="mono why-reg-req">{req}</span>
                          <span className="why-reg-ok">✓</span>
                        </div>
                      ))}
                      <p className="mono why-regs-note">one Runback cassette · satisfies all three</p>
                    </div>
                  )}

                  {/* 5 — any model, any framework */}
                  {i === 4 && (
                    <div className="why-models">
                      {([
                        ["GPT-4o",    "brand"],
                        ["Claude",    "brand2"],
                        ["Gemini",    "brand"],
                        ["Llama 3",   "brand2"],
                        ["Mistral",   "brand"],
                        ["Your model",""],
                      ] as [string, string][]).map(([name, tone]) => (
                        <span key={name} className="why-model-pill mono" data-tone={tone || undefined}>{name}</span>
                      ))}
                      <span className="why-model-more mono">+ any OpenAI-compatible endpoint</span>
                    </div>
                  )}

                  {/* 6 — trust chain comparison */}
                  {i === 5 && (
                    <div className="why-moat-mini">
                      <div className="wmm-side wmm-side-a">
                        <div className="wmm-label" data-v="bad">No trust primitive</div>
                        <div className="wmm-lines">
                          <div className="wmm-line">orchestrator → subagent</div>
                          <div className="wmm-line" data-hi>scope: ??? (unverified)</div>
                          <div className="wmm-line" data-hi>caller: ??? (no proof)</div>
                          <div className="wmm-line" data-hi>injection possible</div>
                        </div>
                      </div>
                      <div className="wmm-side wmm-side-b">
                        <div className="wmm-label" data-v="good">Runback trust chain</div>
                        <div className="wmm-lines">
                          <div className="wmm-line" data-ok>loan-orchestrator  depth:0</div>
                          <div className="wmm-line">  token: a3f8c2d1… (HMAC)</div>
                          <div className="wmm-line" data-ok>  kyc-subagent  depth:1</div>
                          <div className="wmm-line" data-ok>    sig ✓ verifiable offline</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 7 — MTTR: with vs without */}
                  {i === 6 && (
                    <div className="why-time">
                      <div className="why-time-stat">
                        <span className="why-time-n">4m 23s</span>
                        <span className="mono why-time-l">MTTR with Runback</span>
                      </div>
                      <div className="mono why-time-vs">vs</div>
                      <div className="why-time-stat">
                        <span className="why-time-n why-time-bad">3h 48m</span>
                        <span className="mono why-time-l">without captured context</span>
                      </div>
                      <p className="mono why-time-note">loan-approval-agent · 2:47 AM · every month you delay is behavioral data you can never recover</p>
                    </div>
                  )}

                </div>
              </li>
            ))}
          </ol>
          </div>
        </section>
  );
}
