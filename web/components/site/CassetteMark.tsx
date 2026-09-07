/**
 * The blog's signature element: a tape-reel waveform, drawn from the
 * product's own vocabulary (cassette digest, oracle-chain) rather than a
 * generic icon. Two reels + an irregular waveform between them, styled like
 * a captured signal — same visual idea as the thing the posts are about.
 */
export default function CassetteMark() {
  return (
    <svg
      width="72"
      height="28"
      viewBox="0 0 72 28"
      fill="none"
      aria-hidden
      style={{ display: "block", marginBottom: "1.1rem" }}
    >
      <circle cx="8" cy="14" r="6.5" stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="8" cy="14" r="2" fill="var(--text-muted)" />
      <circle cx="64" cy="14" r="6.5" stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="64" cy="14" r="2" fill="var(--text-muted)" />
      <path
        d="M16 14 L22 14 L24 6 L27 22 L30 4 L33 24 L36 8 L39 20 L42 10 L45 18 L48 14 L57.5 14"
        stroke="var(--blue)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
