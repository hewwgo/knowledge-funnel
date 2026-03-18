"use client";

import type { GraphNode, GraphEdge, Submission, Researcher } from "../page";

interface Props {
  concept: GraphNode;
  submissions: Submission[];
  researchers: Researcher[];
  onClose: () => void;
  onNavigate: (conceptId: string) => void;
  allNodes: GraphNode[];
  edges: GraphEdge[];
}

export default function ConceptDetail({
  concept,
  submissions,
  researchers,
  onClose,
  onNavigate,
  allNodes,
  edges,
}: Props) {
  // Find connected concepts via edges
  const connectedConcepts = edges
    .filter((e) => e.source === concept.id || e.target === concept.id)
    .map((e) => {
      const otherId = e.source === concept.id ? e.target : e.source;
      const otherNode = allNodes.find((n) => n.id === otherId);
      return otherNode
        ? { ...otherNode, relation: e.relation, weight: e.weight }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.weight - a!.weight) as (GraphNode & {
    relation: string;
    weight: number;
  })[];

  // Contributing researchers
  const contributingResearchers = concept.researcherIds
    .map((rid) => researchers.find((r) => r.id === rid))
    .filter(Boolean) as Researcher[];

  return (
    <aside className="map-detail">
      <div className="map-detail-header">
        <h2 className="map-detail-title">Concept Detail</h2>
        <button className="map-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="map-detail-body">
        {/* Concept label */}
        <h3 className="map-detail-doc-title">{concept.label}</h3>

        {/* Stats */}
        <p className="map-detail-submitter">
          {concept.submissionCount} submission
          {concept.submissionCount !== 1 ? "s" : ""}
          {concept.isShared && (
            <span className="map-detail-shared-badge">shared interest</span>
          )}
        </p>

        {/* Contributing researchers */}
        {contributingResearchers.length > 0 && (
          <div className="map-detail-researchers">
            <h4 className="map-detail-section-title">Researchers</h4>
            <div className="map-detail-researcher-list">
              {contributingResearchers.map((r) => (
                <div key={r.id} className="map-detail-researcher-item">
                  <span
                    className="map-researcher-swatch"
                    style={{ background: r.color }}
                  />
                  <span>{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submissions referencing this concept */}
        {submissions.length > 0 && (
          <div className="map-detail-submissions">
            <h4 className="map-detail-section-title">Submissions</h4>
            <ul className="map-detail-submission-list">
              {submissions.map((s) => (
                <li key={s.id} className="map-detail-submission-item">
                  <div className="map-detail-submission-header">
                    <span
                      className="map-researcher-swatch"
                      style={{ background: s.submitterColor }}
                    />
                    <strong>{s.title || "Untitled"}</strong>
                  </div>
                  <p className="map-detail-submission-body">
                    {s.body.slice(0, 150)}
                    {s.body.length > 150 ? "..." : ""}
                  </p>
                  <span className="map-detail-submission-meta">
                    {s.submitterName} &middot; {s.contentType}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Connected concepts */}
        {connectedConcepts.length > 0 && (
          <div className="map-detail-neighbors">
            <h4 className="map-detail-section-title">Connected Concepts</h4>
            <ul className="map-detail-neighbors-list">
              {connectedConcepts.map((c) => (
                <li key={c.id} className="map-detail-neighbor">
                  <button
                    className="map-detail-neighbor-btn"
                    onClick={() => onNavigate(c.id)}
                  >
                    <span className="map-detail-neighbor-name">{c.label}</span>
                    <span className="map-detail-neighbor-content">
                      {c.relation} &middot; strength {c.weight}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
