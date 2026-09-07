export default function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="blog-code">
      <div className="blog-code-chrome">
        <span className="blog-code-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="blog-code-label mono">{label}</span>
      </div>
      <pre className="blog-pre">{children}</pre>
    </div>
  );
}
