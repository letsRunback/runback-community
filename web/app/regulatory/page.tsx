import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import { publicFrameworkDef, PUBLIC_REGULATORY_FRAMEWORK_IDS } from "@/lib/regulatoryFrameworks";
import EditionLink from "@/components/EditionLink";

export const metadata = pageMetadata({
  path: "/regulatory",
  title: "Regulatory frameworks — clause-by-clause maps to Runback",
  description:
    "EU AI Act, ISO 42001, NIST AI RMF, APRA CPS 230/234, GDPR, ISO 27001 — how Runback's audit ledger, policy engine, and redaction map to each, with the exact clause and evidence behind every claim.",
});

// Grouped by what each framework actually regulates — not decorative labels,
// the same real classification a compliance reviewer would use. Colors reuse
// existing semantic tokens (no new palette): AI governance = brand-2 (teal,
// the site's existing "verify/sealed" meaning), data protection = emerald,
// information security = blue, operational risk = violet.
type RegCategory = "ai_governance" | "data_protection" | "infosec" | "op_risk";
const CATEGORY: Record<RegCategory, { label: string; color: string }> = {
  ai_governance:   { label: "AI governance",        color: "var(--brand-2)" },
  data_protection: { label: "Data protection",      color: "var(--emerald)" },
  infosec:         { label: "Information security", color: "var(--blue)" },
  op_risk:         { label: "Operational risk",     color: "var(--violet)" },
};

const FRAMEWORKS: { id: string; href: string; name: string; version: string; note: string; cat: RegCategory }[] = [
  { id: "eu_ai_act", href: "/eu-ai-act", name: "EU AI Act", version: "2024/1689", note: "Article 12 logging — hand-assessed, supplied/partial/yours per clause", cat: "ai_governance" },
  ...(["iso_42001", "nist_ai_rmf"] as const).map((id) => {
    const def = publicFrameworkDef(id)!;
    return { id, href: `/regulatory/${id}`, name: def.name, version: def.version, note: `${def.controls.length} clauses mapped`, cat: "ai_governance" as const };
  }),
  ...(["apra_cps230"] as const).map((id) => {
    const def = publicFrameworkDef(id)!;
    return { id, href: `/regulatory/${id}`, name: def.name, version: def.version, note: `${def.controls.length} clauses mapped`, cat: "op_risk" as const };
  }),
  ...(["gdpr"] as const).map((id) => {
    const def = publicFrameworkDef(id)!;
    return { id, href: `/regulatory/${id}`, name: def.name, version: def.version, note: `${def.controls.length} clauses mapped`, cat: "data_protection" as const };
  }),
  ...(["iso_27001", "apra_cps234"] as const).map((id) => {
    const def = publicFrameworkDef(id)!;
    return { id, href: `/regulatory/${id}`, name: def.name, version: def.version, note: `${def.controls.length} clauses mapped`, cat: "infosec" as const };
  }),
];

// Sanity check at build/runtime, not just by inspection — the hand-picked
// category groupings above must still cover exactly the live framework list
// PUBLIC_REGULATORY_FRAMEWORK_IDS exports, or a framework added there later
// silently vanishes from this page instead of erroring.
const coveredIds = new Set(FRAMEWORKS.map((f) => f.id));
for (const id of PUBLIC_REGULATORY_FRAMEWORK_IDS) {
  if (!coveredIds.has(id)) throw new Error(`/regulatory: framework "${id}" is missing from the FRAMEWORKS category grouping`);
}

export default function RegulatoryIndex() {
  return (
    <>
      <Header />
      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Regulatory</span>
          <h1 className="hero-h1" style={{ maxWidth: "18ch" }}>
            Seven frameworks, <span className="accent">one real mapping</span>.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            The same policy engine, hash-chained ledger, and redaction pipeline evaluate against seven
            regulatory frameworks — computed live from your data in the app, and mapped clause-by-clause
            here.
          </p>
          <div className="hero-cta">
            <Link href="/get-started" className="btn-fill">Start free →</Link>
            <EditionLink href="/app/regulatory" className="btn-line">See your org&apos;s status →</EditionLink>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <div className="reg-grid">
            {FRAMEWORKS.map((f) => {
              const c = CATEGORY[f.cat];
              return (
                <Link key={f.id} href={f.href} className="reg-card" style={{ borderTopColor: c.color }}>
                  <span className="reg-card-cat" style={{ color: c.color }}>{c.label}</span>
                  <span className="reg-card-name">{f.name}</span>
                  <span className="reg-card-version mono">{f.version}</span>
                  <span className="reg-card-note">{f.note}</span>
                  <span className="reg-card-arrow" style={{ color: c.color }}>View mapping →</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <p className="mk-lead" style={{ maxWidth: "62ch", fontSize: "0.92rem" }}>
            These are capability maps, not conformity determinations — see each page&apos;s
            &quot;honest limits&quot; section for what it does and doesn&apos;t claim.
          </p>
        </div>
      </section>
      <Footer />
    </>
  );
}
