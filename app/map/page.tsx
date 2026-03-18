"use client";

import { useEffect, useState, useCallback } from "react";
import KnowledgeGraph from "./components/KnowledgeGraph";
import MapControls from "./components/MapControls";
import ConceptDetail from "./components/ConceptDetail";

export interface GraphNode {
  id: string;
  label: string;
  submissionCount: number;
  researcherIds: string[];
  researcherColors: string[];
  isShared: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface Submission {
  id: string;
  title: string;
  body: string;
  contentType: string;
  submitterId: string;
  submitterName: string;
  submitterColor: string;
  concepts: string[];
  createdAt: string;
}

export interface Researcher {
  id: string;
  name: string;
  color: string;
  submissionCount: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  submissions: Submission[];
  researchers: Researcher[];
}

export default function MapPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [hiddenResearchers, setHiddenResearchers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [computing, setComputing] = useState(false);

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
    try {
      let remaining = 1;
      while (remaining > 0) {
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
        remaining = json.remaining || 0;
        // Refresh data after each batch so user sees progress
        await fetchData();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setComputing(false);
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
        <div className="map-empty">Loading graph data...</div>
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

  // Get selected concept data for detail panel
  const selectedConcept = data?.nodes.find((n) => n.id === selectedConceptId) || null;
  const selectedSubmissions = selectedConcept
    ? (data?.submissions || []).filter((s) =>
        s.concepts.includes(selectedConcept.label)
      )
    : [];

  return (
    <div className="map-page">
      {/* Header */}
      <header className="map-header">
        <div className="map-header-left">
          <a href="/" className="map-back">&larr;</a>
          <h1 className="map-title">Knowledge Graph</h1>
          {data && data.nodes.length > 0 && (
            <span className="map-computed-at">
              {data.nodes.length} concepts &middot; {data.edges.length} connections
            </span>
          )}
        </div>
        <button
          className="map-btn"
          onClick={handleCompute}
          disabled={computing}
        >
          {computing ? "Extracting..." : "Extract Concepts"}
        </button>
      </header>

      {isEmpty ? (
        <div className="map-empty">
          <p>No concepts extracted yet.</p>
          <p className="map-empty-sub">
            Submit documents to the funnel, then hit &ldquo;Extract Concepts&rdquo;
            to build the knowledge graph.
          </p>
          <button
            className="map-btn"
            onClick={handleCompute}
            disabled={computing}
          >
            {computing ? "Extracting..." : "Extract Now"}
          </button>
        </div>
      ) : (
        <div className="map-layout">
          <MapControls
            researchers={data!.researchers}
            hiddenResearchers={hiddenResearchers}
            toggleResearcher={toggleResearcher}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
          <div className="map-canvas-container">
            <KnowledgeGraph
              data={data!}
              hiddenResearchers={hiddenResearchers}
              searchQuery={searchQuery}
              onSelectConcept={setSelectedConceptId}
              selectedConceptId={selectedConceptId}
            />
          </div>
          {selectedConcept && (
            <ConceptDetail
              concept={selectedConcept}
              submissions={selectedSubmissions}
              researchers={data!.researchers}
              onClose={() => setSelectedConceptId(null)}
              onNavigate={setSelectedConceptId}
              allNodes={data!.nodes}
              edges={data!.edges}
            />
          )}
        </div>
      )}
    </div>
  );
}
