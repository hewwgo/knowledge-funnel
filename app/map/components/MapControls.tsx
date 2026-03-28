"use client";

interface Researcher {
  id: string;
  name: string;
  color: string;
  submissionCount: number;
}

interface Props {
  researchers: Researcher[];
  hiddenResearchers: Set<string>;
  toggleResearcher: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  totalNodes: number;
  matchingNodes: number;
}

export default function MapControls({
  researchers,
  hiddenResearchers,
  toggleResearcher,
  searchQuery,
  setSearchQuery,
  totalNodes,
  matchingNodes,
}: Props) {
  return (
    <aside className="map-controls">
      {/* Search */}
      <div className="map-controls-section">
        <div style={{ position: "relative" }}>
          <input
            type="text"
            className="map-search"
            placeholder="Search titles, concepts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: "rgba(38,38,36,0.4)",
                cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1,
              }}
            >
              &times;
            </button>
          )}
        </div>
        {searchQuery && (
          <div style={{ fontSize: 10, color: "rgba(38,38,36,0.4)", marginTop: 4 }}>
            {matchingNodes} of {totalNodes} matching
          </div>
        )}
      </div>

      {/* Researchers */}
      <div className="map-controls-section">
        <h3 className="map-controls-heading">Researchers</h3>
        <ul className="map-researcher-list">
          {researchers.map((r) => (
            <li key={r.id} className="map-researcher-item">
              <button
                className="map-researcher-toggle"
                onClick={() => toggleResearcher(r.id)}
                style={{ opacity: hiddenResearchers.has(r.id) ? 0.3 : 1 }}
              >
                <span
                  className="map-researcher-swatch"
                  style={{ background: r.color }}
                />
                <span className="map-researcher-name">{r.name}</span>
                <span className="map-researcher-count">{r.submissionCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Legend */}
      <div className="map-controls-section">
        <h3 className="map-controls-heading">Legend</h3>
        <div className="map-legend">
          <div className="map-legend-item">
            <span className="map-legend-circle map-legend-single" />
            <span className="map-legend-text">Submission</span>
          </div>
          <div className="map-legend-item">
            <span style={{ width: 12, height: 12, borderRadius: "50%", border: "1.5px solid #56B4E9", background: "transparent", flexShrink: 0 }} />
            <span className="map-legend-text">Paper (has type ring)</span>
          </div>
          <div className="map-legend-item">
            <span style={{ width: 16, height: 0, borderTop: "1.5px dashed #D55E00", flexShrink: 0 }} />
            <span className="map-legend-text">Exploration selection</span>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="map-controls-section" style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 10, color: "rgba(38,38,36,0.35)", lineHeight: 1.6 }}>
          Click a node to inspect.<br />
          Shift+click to select for exploration.<br />
          Click a cluster region for overview.<br />
          Scroll to zoom, drag to pan.
        </div>
      </div>
    </aside>
  );
}
