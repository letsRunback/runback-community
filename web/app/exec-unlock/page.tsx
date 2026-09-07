import ExecUnlockForm from "./ExecUnlockForm";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/exec-unlock",
  title: "Private briefing",
  robots: { index: false, follow: false },
});

export default function ExecUnlockPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
      }}
    >
      <ExecUnlockForm />
    </main>
  );
}
