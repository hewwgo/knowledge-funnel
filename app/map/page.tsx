"use client";

import { useEffect, useState, useCallback } from "react";
import KnowledgeMap from "./components/KnowledgeMap";
import MapControls from "./components/MapControls";
import FragmentDetail from "./components/FragmentDetail";

interface Fragment {
  id: string;
  content: string;
  fullContent: string;
  submitterId: string;
  submitterName: string;
  submitterColor: string;
  documentTitle: string;
  x: number;
  y: number;
  clusterId: number | null;
  tags: string[];
  createdAt: string;
}

interface Cluster {
  id: number;
  label: string;
  centroidX: number;
  centroidY: number;
  memberCount: number;
  submitterIds: string[];
}

interface Researcher {
  id: string;
  name: string;
  color: string;
  fragmentCount: number;
}

export interface MapData {
  fragments: Fragment[];
  clusters: Cluster[];
  researchers: Researcher[];
  computedAt: string | null;
}

export default function MapPage() {
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFragmentId, setSelectedFragmentId] = useState<string | null>(null);
  const [hiddenResearchers, setHiddenResearchers] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
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
    try {
      const res = await fetch("/api/map/compute", { method: "POST" });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Compute returned invalid response (${res.status}): ${text.slice(0, 300)}`);
      }
      if (!res.ok) {
        throw new Error(json.error || `Compute failed (${res.status})`);
      }
      await fetchData();
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

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // Collect all unique tags
  const allTags = data
    ? [...new Set(data.fragments.flatMap((f) => f.tags))].sort()
    : [];

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

  const isEmpty = !data || data.fragments.length === 0;

  return (
    <div className="map-page">
      {/* Header */}
      <header className="map-header">
        <div className="map-header-left">
          <a href="/" className="map-back">&larr;</a>
          <h1 className="map-title">Knowledge Map</h1>
          {data?.computedAt && (
            <span className="map-computed-at">
              Computed {new Date(data.computedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <button
          className="map-btn"
          onClick={handleCompute}
          disabled={computing}
        >
          {computing ? "Computing..." : "Recompute Map"}
        </button>
      </header>

      {isEmpty ? (
        <div className="map-empty">
          <p>No map data yet.</p>
          <p className="map-empty-sub">
            Submit documents to the funnel, then hit &ldquo;Recompute Map&rdquo; to generate the projection.
          </p>
          <button className="map-btn" onClick={handleCompute} disabled={computing}>
            {computing ? "Computing..." : "Compute Now"}
          </button>
        </div>
      ) : (
        <div className="map-layout">
          <MapControls
            researchers={data!.researchers}
            hiddenResearchers={hiddenResearchers}
            toggleResearcher={toggleResearcher}
            allTags={allTags}
            selectedTags={selectedTags}
            toggleTag={toggleTag}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
          <div className="map-canvas-container">
            <KnowledgeMap
              data={data!}
              hiddenResearchers={hiddenResearchers}
              selectedTags={selectedTags}
              searchQuery={searchQuery}
              onSelectFragment={setSelectedFragmentId}
              selectedFragmentId={selectedFragmentId}
            />
          </div>
          {selectedFragmentId && (
            <FragmentDetail
              fragmentId={selectedFragmentId}
              onClose={() => setSelectedFragmentId(null)}
              onNavigate={setSelectedFragmentId}
            />
          )}
        </div>
      )}
    </div>
  );
}
