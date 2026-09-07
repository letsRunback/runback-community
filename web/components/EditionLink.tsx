import Link from "next/link";
import { routeAvailable } from "@/lib/edition";

/**
 * A link to a route that may not exist in this build.
 *
 * Where the route is present this is exactly `<Link>`. Where it isn't — the
 * Community build drops several — it renders the label as plain text instead
 * of a link to a 404. The sentence around it still reads correctly, which is
 * why these degrade to text rather than disappearing: most of these links sit
 * mid-sentence ("configure a rule under Alerts"), and removing the words would
 * leave the sentence broken.
 */
export default function EditionLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!routeAvailable(href)) return <span className={className}>{children}</span>;
  return <Link href={href} className={className}>{children}</Link>;
}
