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
}

export default function MapControls({
  researchers,
  hiddenResearchers,
  toggleResearcher,
  searchQuery,
  setSearchQuery,
}: Props) {
  return (
    <aside className="map-controls">
      {/* Search */}
      <div className="map-controls-section">
        <input
          type="text"
          className="map-search"
          placeholder="Search concepts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
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
            <span className="map-legend-text">Single researcher</span>
          </div>
          <div className="map-legend-item">
            <span className="map-legend-circle map-legend-shared" />
            <span className="map-legend-text">Shared interest</span>
          </div>
          <div className="map-legend-item">
            <span className="map-legend-line" />
            <span className="map-legend-text">Co-occurrence</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
