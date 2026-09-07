import Link from "next/link";
import { requireSession, atLeast } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { VERTICALS, type Vertical } from "@/lib/verticals";
import { can } from "@/lib/entitlements";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import ModelKeys from "./ModelKeys";
import VerticalPicker from "./VerticalPicker";
import CorpusOptIn from "./CorpusOptIn";
import ApiKeySection from "./ApiKeySection";
import DeleteAccount from "./DeleteAccount";
import ComplianceKeySection from "./ComplianceKeySection";
import SecurityFindingsKeySection from "./SecurityFindingsKeySection";
import ExternalGrantsSection from "./ExternalGrantsSection";
import ScimSection from "./ScimSection";
import LegalHolds from "./LegalHolds";
import SiemExport from "./SiemExport";
import { UPGRADE_HREF, routeAvailable } from "@/lib/edition";
import EditionLink from "@/components/EditionLink";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: org } = await sb
    .from("orgs")
    .select("vertical, corpus_opt_in")
    .eq("id", session.orgId)
    .maybeSingle();

  const currentVertical: Vertical = (org?.vertical in VERTICALS ? org.vertical : "general") as Vertical;
  // Default OFF, matching the column default. sql/update_corpus_opt_in_default
  // set that to false for GDPR Art. 25 privacy-by-default; `?? true` here meant
  // that whenever the org row failed to load, the toggle rendered ON against a
  // stored false — and saving from that screen would have flipped a customer to
  // sharing fleet telemetry they never opted into.
  const corpusOptIn: boolean = org?.corpus_opt_in ?? false;
  const hasBenchmark = can(session.orgPlan, "benchmark");
  const hasRegulatory = can(session.orgPlan, "regulatory");
  const hasSso = can(session.orgPlan, "sso");
  const hasCompliance = can(session.orgPlan, "compliance");
  // The demo workspace is shared and reachable without signing up, so anything
  // destructive or credential-shaped on this page is being shown to anonymous
  // visitors — including each other's.
  const isDemoWorkspace = DEMO_MODE || isDemoEmail(session.email);

  const tools = [
    { href: "/app/team",       label: "Team" },
    { href: "/app/alerts",     label: "Alerts" },
    { href: "/app/models",     label: "Models" },
    { href: "/app/cost",       label: "Cost" },
    { href: "/app/usage",      label: "Usage" },
    { href: "/app/compliance", label: "Compliance" },
  ];

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Settings</h1>
      </div>

      {/* Workspace */}
      <section className="settings-section">
        <div className="settings-section-label">Workspace</div>
        <div className="settings-card appc-card settings-card-full">
          <div className="appc-kv"><span>Name</span><strong>{session.orgName}</strong></div>
          <div className="appc-kv"><span>Your email</span><strong className="mono">{session.email}</strong></div>
          <div className="appc-kv"><span>Your role</span><strong className="mono settings-role">{session.role}</strong></div>
        </div>
      </section>

      {/* Industry */}
      <section className="settings-section">
        <div className="settings-section-label">Industry</div>
        <div className="appc-card settings-card-full">
          <p className="settings-hint">
            Segments your fleet benchmarks against peers in the same vertical — policy block rates and latency norms vary significantly by industry.
          </p>
          {/* POST /api/settings/vertical requires "admin" — canEdit used to be
              true for "member" too, so a member could interact with the
              picker and always get a 403 back. */}
          <VerticalPicker current={currentVertical} canEdit={atLeast(session.role, "admin")} />
        </div>
      </section>

      {/* Security & Billing */}
      <section className="settings-section">
        <div className="settings-section-label">Security & Billing</div>
        <div className="appc-card settings-card-full">
          <div className="appc-kv">
            <span>Single sign-on (SSO)</span>
            <Link href="/app/settings/sso" className="appc-link">Configure →</Link>
          </div>
          <div className="appc-kv">
            <span>Plan &amp; billing</span>
            <Link href={UPGRADE_HREF} className="appc-link">Manage →</Link>
          </div>
        </div>
      </section>

      {/* Fleet intelligence (if unlocked) */}
      {hasBenchmark && (
        <section className="settings-section">
          <div className="settings-section-label">Intelligence</div>
          <div className="appc-card settings-card-full">
            <p className="settings-hint">
              Contribute anonymized signals — policy block rate, error rate, latency, token efficiency — to the Runback fleet.
              No payloads, prompts, or outputs are shared.{" "}
              <EditionLink href="/app/benchmark" className="appc-link">See your benchmarks →</EditionLink>
            </p>
            <CorpusOptIn
              current={corpusOptIn}
              canEdit={session.role === "owner" || session.role === "admin"}
            />
          </div>
        </section>
      )}

      {/* Runback API key — for SDK integration */}
      <section className="settings-section">
        <div className="settings-section-label">API Key (SDK)</div>
        <ApiKeySection canAdmin={atLeast(session.role, "admin")} />
      </section>

      {/* Compliance evidence key — for integrations like EAAPL (Enterprise only) */}
      {hasRegulatory && (
        <section className="settings-section">
          <div className="settings-section-label">Compliance Evidence Key</div>
          <ComplianceKeySection canAdmin={atLeast(session.role, "admin")} />
        </section>
      )}

      {/* Directory provisioning — joiners and leavers from the IdP (Enterprise) */}
      {hasSso && (
        <section className="settings-section">
          <div className="settings-section-label">Directory Provisioning (SCIM)</div>
          <ScimSection canAdmin={atLeast(session.role, "admin")} />
        </section>
      )}

      {/* Legal holds — suspend retention deletion (Enterprise) */}
      {hasCompliance && (
        <section className="settings-section">
          <div className="settings-section-label">Legal Holds</div>
          <LegalHolds canAdmin={atLeast(session.role, "admin")} />
        </section>
      )}

      {/* SIEM export — audit events into the customer's SOC (Enterprise) */}
      {hasCompliance && (
        <section className="settings-section">
          <div className="settings-section-label">SIEM Export</div>
          <SiemExport canAdmin={atLeast(session.role, "admin")} />
        </section>
      )}

      {/* Security findings key — for guardrail vendor webhooks (Enterprise) */}
      {hasCompliance && (
        <section className="settings-section">
          <div className="settings-section-label">Security Findings Key</div>
          <SecurityFindingsKeySection canAdmin={atLeast(session.role, "admin")} />
        </section>
      )}

      {/* External auditor/regulator grants — read-only, time-limited (Enterprise) */}
      {hasCompliance && (
        <section className="settings-section">
          <div className="settings-section-label">External Grants (Auditor Access)</div>
          <ExternalGrantsSection canAdmin={atLeast(session.role, "admin")} />
        </section>
      )}

      {/* Model keys.

          In the shared demo this is a form asking anonymous visitors to paste a
          real OpenAI or Anthropic key into a workspace the page itself labels
          "nothing here is private". Replaced with an explanation there. */}
      <section className="settings-section">
        <div className="settings-section-label">Model Keys (LLM providers)</div>
        {isDemoWorkspace ? (
          <div className="appc-card settings-card-full">
            <p className="settings-hint">
              Disabled in the shared demo. This is where you would add an OpenAI, Anthropic or
              Groq key so replay can re-execute a step against a different model. Never paste a
              real provider credential into a workspace you share with strangers — including
              this one.{" "}
              <Link href="/get-started" className="appc-link">Create your own workspace →</Link>
            </p>
          </div>
        ) : (
          <ModelKeys />
        )}
      </section>

      {/* Tools quick-nav */}
      <section className="settings-section">
        <div className="settings-section-label">Tools</div>
        <div className="settings-tools-grid">
          {tools.filter((t) => routeAvailable(t.href)).map(({ href, label }) => (
            <Link key={href} href={href} className="settings-tool-link">
              {label}
              <span className="arrow mono">→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* GDPR Art.17 erasure. The endpoint existed and was unreachable; /privacy
          promises self-service deletion, so this is the promise being kept.

          Hidden in the shared demo workspace. /demo and /login invite anyone to
          explore it without signing up, which put a button that destroys the
          org — and everything every other visitor is looking at — in front of
          anonymous traffic. The endpoint still enforces its own permissions;
          this removes the invitation. */}
      {!isDemoWorkspace && (
        <section className="settings-section">
          <div className="settings-section-label settings-danger-label">Danger zone</div>
          <DeleteAccount />
        </section>
      )}
    </div>
  );
}
