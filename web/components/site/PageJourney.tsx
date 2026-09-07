import Link from "next/link";

const JOURNEY_STEPS = [
  { href: "/use-cases", label: "Use cases" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/pricing", label: "Pricing" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/docs", label: "Docs" },
] as const;

type JourneyHref = (typeof JOURNEY_STEPS)[number]["href"];

// Marketing routes proxy.ts's self-host gate leaves reachable pre-login (see
// proxy.ts's matcher comment). Everything else in JOURNEY_STEPS 307-redirects
// to /login on a self-hosted deployment, so those steps must not be links
// there.
const SELF_HOSTED_REACHABLE: readonly JourneyHref[] = ["/docs", "/how-it-works"];

/**
 * A thin "you are here" strip for the handful of pages a first-time
 * evaluator actually needs to sequence: why does this page exist, where does
 * it sit relative to the others, what's the next honest step. Answers the
 * "particular page doesn't have journeys and their justifications" gap
 * directly rather than leaving it to nav guesswork.
 */
export default function PageJourney({
  current,
  why,
  next,
  selfHosted = false,
}: {
  current: JourneyHref;
  why: string;
  next: { href: string; label: string };
  selfHosted?: boolean;
}) {
  const nextReachable = !selfHosted || SELF_HOSTED_REACHABLE.includes(next.href as JourneyHref);
  const stepIndex = JOURNEY_STEPS.findIndex((s) => s.href === current);
  const currentStep = JOURNEY_STEPS[stepIndex];
  return (
    <div className="pj">
      {/* The full six-step trail used to render here, directly under a header
          already containing four of the same six links — a second navigation
          bar restating the first. What the header genuinely cannot say is
          WHERE YOU ARE and WHAT COMES NEXT, so that is all this keeps: the
          current step as a position marker, the reason this page exists, and
          one onward link. The step list itself was the duplication. */}
      <div className="pj-trail mono" aria-label="Where this page sits in the Runback journey">
        <span className="pj-step-of mono">
          Step {stepIndex + 1} of {JOURNEY_STEPS.length}
        </span>
        <span className="pj-here" aria-current="page">{currentStep?.label ?? ""}</span>
      </div>
      <p className="pj-why">{why}</p>
      {nextReachable && <Link href={next.href} className="pj-next mk-link">{next.label} →</Link>}
    </div>
  );
}
