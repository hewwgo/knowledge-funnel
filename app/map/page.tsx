"use client";

import { useEffect, useState, useCallback } from "react";
import KnowledgeGraph from "./components/KnowledgeGraph";
import MapControls from "./components/MapControls";
import ConceptDetail from "./components/ConceptDetail";
import ClusterDetail from "./components/ClusterDetail";

export interface MapNode {
  id: string;
  title: string;
  body: string;
  contentType: string;
  x: number;
  y: number;
  clusterId: number | null;
  submitterId: string;
  submitterName: string;
  submitterColor: string;
  concepts: string[];
  distinctiveConcepts: string[];
  createdAt: string;
}

export interface Cluster {
  id: number;
  label: string;
  points: [number, number][];
  centroidX: number;
  centroidY: number;
  memberCount: number;
  submitterIds: string[];
}

export interface Researcher {
  id: string;
  name: string;
  color: string;
  submissionCount: number;
}

export interface MapData {
  nodes: MapNode[];
  clusters: Cluster[];
  researchers: Researcher[];
  computedAt: string | null;
}

export default function MapPage() {
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [hiddenResearchers, setHiddenResearchers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [computing, setComputing] = useState(false);
  const [computeProgress, setComputeProgress] = useState("");
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/map/data");
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Server returned invalid JSON: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(json.error || "Failed to fetch map data");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCompute = async () => {
    setComputing(true);
    setError(null);
    setComputeProgress("Computing UMAP projection...");
    try {
      const res = await fetch("/api/map/compute", { method: "POST" });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          `Compute returned invalid response (${res.status}): ${text.slice(0, 300)}`
        );
      }
      if (!res.ok) {
        throw new Error(json.error || `Compute failed (${res.status})`);
      }
      setComputeProgress(
        `Done! ${json.projectedCount || 0} submissions projected, ${json.clusterCount || 0} clusters found.`
      );
      await fetchData();
    } catch (e) {
      setError(String(e));
    } finally {
      setComputing(false);
      setTimeout(() => setComputeProgress(""), 4000);
    }
  };

  const toggleResearcher = (id: string) => {
    setHiddenResearchers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="map-page">
        <div className="map-empty">Loading map data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="map-page">
        <div className="map-empty">
          <p>Error: {error}</p>
          <button className="map-btn" onClick={fetchData}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isEmpty = !data || data.nodes.length === 0;

  // Selection handlers — selecting one deselects the other
  const handleSelectNode = (id: string) => {
    setSelectedNodeId(id);
    setSelectedClusterId(null);
  };

  const handleSelectCluster = (id: number) => {
    setSelectedClusterId(id);
    setSelectedNodeId(null);
  };

  const handleToggleMultiSelect = (id: string) => {
    setMultiSelectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExploreSelected = () => {
    const ids = Array.from(multiSelectIds).join(",");
    window.location.href = `/explore?seeds=${ids}`;
  };

  // Get selected items for detail panels
  const selectedNode = data?.nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedCluster = data?.clusters.find((c) => c.id === selectedClusterId) || null;

  return (
    <div className="map-page">
      {/* Header */}
      <header className="map-header">
        <div className="map-header-left">
          <a href="/" className="map-back">&larr;</a>
          <h1 className="map-title">Tessera &mdash; Knowledge Map</h1>
          {data && data.nodes.length > 0 && (
            <span className="map-computed-at">
              {data.nodes.length} submissions &middot; {data.clusters.length} clusters
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {computeProgress && (
            <span style={{ fontSize: "12px", color: "#666" }}>{computeProgress}</span>
          )}
          <button
            className="map-btn"
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? "Computing..." : "Recompute Map"}
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="map-empty">
          <p>No map data yet.</p>
          <p className="map-empty-sub">
            Submit documents to the funnel, then hit &ldquo;Recompute Map&rdquo;
            to generate the knowledge map.
          </p>
          <button
            className="map-btn"
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? "Computing..." : "Compute Now"}
          </button>
        </div>
      ) : (
        <div className="map-fullscreen">
          {/* Full-screen canvas */}
          <KnowledgeGraph
            data={data!}
            hiddenResearchers={hiddenResearchers}
            searchQuery={searchQuery}
            onSelectNode={handleSelectNode}
            selectedNodeId={selectedNodeId}
            onSelectCluster={handleSelectCluster}
            selectedClusterId={selectedClusterId}
            multiSelectIds={multiSelectIds}
            onToggleMultiSelect={handleToggleMultiSelect}
          />

          {/* Floating controls — top left */}
          <div className="map-float-controls">
            <MapControls
              researchers={data!.researchers}
              hiddenResearchers={hiddenResearchers}
              toggleResearcher={toggleResearcher}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              totalNodes={data!.nodes.length}
              matchingNodes={searchQuery
                ? data!.nodes.filter((n) =>
                    n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    n.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()))
                  ).length
                : data!.nodes.length}
            />
          </div>

          {/* Floating detail panel — right side */}
          {(selectedNode || multiSelectIds.size > 0) && (
            <div className="map-float-detail">
              <ConceptDetail
                node={selectedNode || (multiSelectIds.size > 0 ? data!.nodes.find((n) => multiSelectIds.has(n.id))! : null)!}
                researchers={data!.researchers}
                allNodes={data!.nodes}
                onClose={() => { setSelectedNodeId(null); setMultiSelectIds(new Set()); }}
                onSelectNode={handleSelectNode}
                multiSelectedNodes={data!.nodes.filter((n) => multiSelectIds.has(n.id))}
                onDeselectNode={(id) => {
                  setMultiSelectIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }}
              />
            </div>
          )}

          {/* Floating cluster detail */}
          {selectedCluster && (
            <div className="map-float-detail">
              <ClusterDetail
                cluster={selectedCluster}
                nodes={data!.nodes}
                researchers={data!.researchers}
                onClose={() => setSelectedClusterId(null)}
                onSelectNode={handleSelectNode}
              />
            </div>
          )}
          {multiSelectIds.size > 0 && (
            <div className="map-selection-bar">
              <span>{multiSelectIds.size} selected</span>
              <button className="map-selection-explore" onClick={handleExploreSelected}>
                Compose
              </button>
              <button onClick={() => setMultiSelectIds(new Set())}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
