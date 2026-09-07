/**
 * The category-defining visual: software's commit, side by side with
 * Runback's cassette — the same primitive, applied to a different kind of
 * event. This is the thesis in diagram form, not prose; the surrounding
 * section still carries the argument in words for anyone who wants it, but
 * a visitor should get the point from this alone.
 */
const COMMIT_FIELDS = ["Diff", "Author", "Tests", "History"];
const CASSETTE_FIELDS = ["Context", "Model", "Tools", "Decision", "Evidence"];

export default function CommitCassette() {
  return (
    <div className="cc-wrap">
      <div className="cc-cols">
        <div className="cc-col">
          <div className="cc-col-k mono">Software</div>
          <div className="cc-node cc-node-top">Code</div>
          <div className="cc-stem" aria-hidden />
          <div className="cc-node cc-node-main" data-tone="brand2">
            <span className="cc-node-label mono">COMMIT</span>
            <span className="cc-node-hash mono">a84c92e</span>
          </div>
          <ul className="cc-fields">
            {COMMIT_FIELDS.map((f) => (
              <li key={f}><span className="cc-field-tick mono">├──</span>{f}</li>
            ))}
          </ul>
        </div>

        <div className="cc-col">
          <div className="cc-col-k mono">AI agents</div>
          <div className="cc-node cc-node-top">Decision</div>
          <div className="cc-stem" aria-hidden />
          <div className="cc-node cc-node-main" data-tone="brand">
            <span className="cc-node-label mono">CASSETTE</span>
            <span className="cc-node-hash mono">rb-84c92</span>
          </div>
          <ul className="cc-fields">
            {CASSETTE_FIELDS.map((f) => (
              <li key={f}><span className="cc-field-tick mono">├──</span>{f}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="cc-line">
        Git gave software a record of change.<br />
        <strong>Runback gives AI a record of behaviour.</strong>
      </p>
    </div>
  );
}
