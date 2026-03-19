"use client";

import type { MapNode, Researcher } from "../page";

interface Props {
  node: MapNode;
  researchers: Researcher[];
  onClose: () => void;
}

export default function ConceptDetail({
  node,
  researchers,
  onClose,
}: Props) {
  const researcher = researchers.find((r) => r.id === node.submitterId);

  const contentIcon =
    node.contentType === "paper" ? "📄" :
    node.contentType === "link" ? "🔗" :
    node.contentType === "idea" ? "💡" : "📝";

  return (
    <aside className="map-detail">
      <div className="map-detail-header">
        <h2 className="map-detail-title">Submission Detail</h2>
        <button className="map-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="map-detail-body">
        {/* Title */}
        <h3 className="map-detail-doc-title">
          {contentIcon} {node.title}
        </h3>

        {/* Submitter */}
        <p className="map-detail-submitter">
          <span
            className="map-researcher-swatch"
            style={{ background: node.submitterColor }}
          />
          {node.submitterName}
          {researcher && (
            <span style={{ color: "#888", marginLeft: 8 }}>
              {researcher.submissionCount} submission{researcher.submissionCount !== 1 ? "s" : ""} total
            </span>
          )}
        </p>

        {/* Content */}
        {node.body && (
          <div className="map-detail-submissions">
            <h4 className="map-detail-section-title">Content</h4>
            <p className="map-detail-submission-body">
              {node.body}
            </p>
          </div>
        )}

        {/* Concepts/tags */}
        {node.concepts.length > 0 && (
          <div className="map-detail-neighbors">
            <h4 className="map-detail-section-title">Concepts</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {node.concepts.map((c) => (
                <span
                  key={c}
                  style={{
                    background: "rgba(38, 38, 36, 0.08)",
                    padding: "3px 8px",
                    fontSize: "11px",
                    fontWeight: 500,
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Meta */}
        <div style={{ marginTop: 16, fontSize: "11px", color: "#888" }}>
          {node.contentType} &middot; {new Date(node.createdAt).toLocaleDateString()}
        </div>
      </div>
    </aside>
  );
}
