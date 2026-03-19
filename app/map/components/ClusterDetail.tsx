"use client";

import { useState, useEffect } from "react";
import type { Cluster, MapNode, Researcher } from "../page";

interface Props {
  cluster: Cluster;
  nodes: MapNode[];
  researchers: Researcher[];
  onClose: () => void;
  onSelectNode: (id: string) => void;
}

export default function ClusterDetail({
  cluster,
  nodes,
  researchers,
  onClose,
  onSelectNode,
}: Props) {
  const [bridge, setBridge] = useState<string | null>(null);
  const [loadingBridge, setLoadingBridge] = useState(false);

  // Get submissions in this cluster
  const clusterNodes = nodes.filter((n) => n.clusterId === cluster.id);

  // Group by researcher
  const byResearcher = new Map<string, MapNode[]>();
  for (const n of clusterNodes) {
    if (!byResearcher.has(n.submitterId)) byResearcher.set(n.submitterId, []);
    byResearcher.get(n.submitterId)!.push(n);
  }

  const researcherEntries = Array.from(byResearcher.entries()).map(([rid, subs]) => {
    const r = researchers.find((r) => r.id === rid);
    return { id: rid, name: r?.name || "Unknown", color: r?.color || "#999", submissions: subs };
  });

  const isMultiResearcher = researcherEntries.length > 1;

  // Fetch bridge summary on mount if multi-researcher
  useEffect(() => {
    if (!isMultiResearcher) return;
    setLoadingBridge(true);
    setBridge(null);

    fetch("/api/map/bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clusterId: cluster.id }),
    })
      .then((res) => res.json())
      .then((data) => setBridge(data.bridge || data.error || "No bridge generated."))
      .catch(() => setBridge("Failed to generate bridge summary."))
      .finally(() => setLoadingBridge(false));
  }, [cluster.id, isMultiResearcher]);

  return (
    <aside className="map-detail">
      <div className="map-detail-header">
        <h2 className="map-detail-title">Cluster Detail</h2>
        <button className="map-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="map-detail-body">
        {/* Cluster label */}
        <h3 className="map-detail-doc-title" style={{ fontStyle: "italic" }}>
          {cluster.label}
        </h3>

        <p style={{ fontSize: "12px", color: "#888", margin: "4px 0 16px" }}>
          {clusterNodes.length} submission{clusterNodes.length !== 1 ? "s" : ""} &middot;{" "}
          {researcherEntries.length} researcher{researcherEntries.length !== 1 ? "s" : ""}
        </p>

        {/* Bridge summary (multi-researcher only) */}
        {isMultiResearcher && (
          <div style={{
            background: "#fff4eb",
            border: "1.5px solid #d4a574",
            padding: "12px 14px",
            marginBottom: 16,
          }}>
            <h4 style={{
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#d4a574",
              margin: "0 0 6px",
            }}>
              Common Ground
            </h4>
            {loadingBridge ? (
              <p style={{ fontSize: "12px", color: "#888", margin: 0 }}>
                Analyzing overlap...
              </p>
            ) : (
              <p style={{ fontSize: "12px", lineHeight: 1.5, color: "#262624", margin: 0 }}>
                {bridge}
              </p>
            )}
          </div>
        )}

        {/* Researcher breakdown */}
        <div className="map-detail-submissions">
          <h4 className="map-detail-section-title">Contributions</h4>
          {researcherEntries.map((entry) => (
            <div key={entry.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span
                  className="map-researcher-swatch"
                  style={{ background: entry.color }}
                />
                <span style={{ fontSize: "12px", fontWeight: 600 }}>
                  {entry.name}
                </span>
                <span style={{ fontSize: "11px", color: "#888" }}>
                  ({entry.submissions.length})
                </span>
              </div>
              {entry.submissions.map((sub) => (
                <div
                  key={sub.id}
                  onClick={() => onSelectNode(sub.id)}
                  style={{
                    padding: "6px 8px",
                    marginLeft: 16,
                    marginBottom: 4,
                    fontSize: "11px",
                    cursor: "pointer",
                    background: "rgba(38, 38, 36, 0.03)",
                    borderLeft: `3px solid ${entry.color}`,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {sub.contentType === "paper" ? "📄" :
                     sub.contentType === "link" ? "🔗" :
                     sub.contentType === "idea" ? "💡" : "📝"}{" "}
                    {sub.title}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
