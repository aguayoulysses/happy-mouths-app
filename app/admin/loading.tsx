// Shown the instant a sidebar tab is clicked, while the page's queries run on the server.
// Without it a click gave no feedback until the whole page came back.
export default function OpsLoading() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div>
          <div className="sk-line" style={{ width: 160, height: 26 }} />
          <div className="sk-line" style={{ width: 240, marginTop: 10 }} />
        </div>
      </div>
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat">
            <div className="sk-line" style={{ width: 70, height: 26 }} />
            <div className="sk-line" style={{ width: 110, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="section-label"><span className="sk-line" style={{ width: 120, display: "inline-block" }} /></div>
      <div className="list-box">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="attn-row"><span className="sk-line" style={{ width: "40%" }} /></div>
        ))}
      </div>
    </div>
  );
}
