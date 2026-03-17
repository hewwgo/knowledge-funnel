"use client";

interface Researcher {
  id: string;
  name: string;
  color: string;
  fragmentCount: number;
}

interface Props {
  researchers: Researcher[];
  hiddenResearchers: Set<string>;
  toggleResearcher: (id: string) => void;
  allTags: string[];
  selectedTags: Set<string>;
  toggleTag: (tag: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export default function MapControls({
  researchers,
  hiddenResearchers,
  toggleResearcher,
  allTags,
  selectedTags,
  toggleTag,
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
          placeholder="Search fragments..."
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
                <span className="map-researcher-count">{r.fragmentCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="map-controls-section">
          <h3 className="map-controls-heading">Tags</h3>
          <div className="map-tag-list">
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`map-tag-chip ${selectedTags.has(tag) ? "map-tag-chip-active" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
