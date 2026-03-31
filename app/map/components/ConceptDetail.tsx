"use client";

import type { MapNode, Researcher } from "../page";

interface Props {
  node: MapNode;
  researchers: Researcher[];
  allNodes: MapNode[];
  onClose: () => void;
  onSelectNode?: (id: string) => void;
  multiSelectedNodes?: MapNode[];
  onDeselectNode?: (id: string) => void;
}

export default function ConceptDetail({
  node,
  researchers,
  allNodes,
  onClose,
  onSelectNode,
  multiSelectedNodes = [],
  onDeselectNode,
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

        {/* Concepts — distinctive ones highlighted inline */}
        {node.concepts.length > 0 && (
          <div className="map-detail-neighbors">
            <h4 className="map-detail-section-title">Concepts</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {node.concepts.map((c) => {
                const isDistinctive = node.distinctiveConcepts?.includes(c);
                return (
                  <span
                    key={c}
                    style={{
                      background: isDistinctive ? "rgba(213, 94, 0, 0.08)" : "rgba(38, 38, 36, 0.06)",
                      border: isDistinctive ? "1px solid rgba(213, 94, 0, 0.25)" : "1px solid rgba(38, 38, 36, 0.1)",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: isDistinctive ? 600 : 400,
                      color: isDistinctive ? "#D55E00" : "#262624",
                    }}
                  >
                    {c}
                  </span>
                );
              })}
            </div>
            {node.distinctiveConcepts && node.distinctiveConcepts.length > 0 && (
              <p style={{ fontSize: 9, color: "rgba(38,38,36,0.4)", marginTop: 6 }}>
                Orange = rare in corpus (distinctive to this submission)
              </p>
            )}
          </div>
        )}

        {/* Other submissions by same researcher */}
        {(() => {
          const others = allNodes.filter(
            (n) => n.submitterId === node.submitterId && n.id !== node.id
          );
          if (others.length === 0) return null;
          return (
            <div className="map-detail-neighbors" style={{ marginTop: 16 }}>
              <h4 className="map-detail-section-title">
                Other by {node.submitterName} ({others.length})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {others.slice(0, 5).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => onSelectNode?.(o.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 8px", background: "rgba(255,255,255,0.6)",
                      border: "1px solid rgba(212,165,116,0.2)",
                      cursor: "pointer", textAlign: "left", fontFamily: "Inter, sans-serif",
                      width: "100%",
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: o.submitterColor, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 10, color: "#262624", lineHeight: 1.3 }}>
                      {o.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Meta */}
        <div style={{ marginTop: 16, fontSize: "11px", color: "#888" }}>
          {node.contentType} &middot; {new Date(node.createdAt).toLocaleDateString()}
        </div>

        {/* Multi-selected nodes */}
        {multiSelectedNodes.length > 0 && (
          <div className="map-detail-neighbors" style={{ marginTop: 20 }}>
            <h4 className="map-detail-section-title">
              Selected Tiles ({multiSelectedNodes.length})
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {multiSelectedNodes.map((n) => {
                const icon =
                  n.contentType === "paper" ? "📄" :
                  n.contentType === "link" ? "🔗" :
                  n.contentType === "idea" ? "💡" : "📝";
                return (
                  <div
                    key={n.id}
                    style={{
                      padding: "8px 10px",
                      background: "rgba(255, 255, 255, 0.6)",
                      border: n.id === node.id ? "1.5px solid #262624" : "1px solid rgba(212, 165, 116, 0.2)",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 10, height: 10, borderRadius: "50%",
                        background: n.submitterColor, flexShrink: 0, marginTop: 3,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#262624", lineHeight: 1.3 }}>
                        {icon} {n.title}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(38, 38, 36, 0.5)", marginTop: 2 }}>
                        {n.submitterName}
                      </div>
                    </div>
                    {onDeselectNode && (
                      <button
                        onClick={() => onDeselectNode(n.id)}
                        style={{
                          background: "none", border: "none", color: "rgba(38,38,36,0.4)",
                          cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1, flexShrink: 0,
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
