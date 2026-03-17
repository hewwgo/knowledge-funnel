"use client";

import { useEffect, useState } from "react";

interface FragmentData {
  id: string;
  content: string;
  submitterName: string;
  documentTitle: string;
  documentUrl: string | null;
  tags: string[];
  clusterId: number | null;
  clusterLabel: string | null;
  nearestNeighbors: {
    id: string;
    content: string;
    submitterName: string;
    distance: number;
  }[];
}

interface Props {
  fragmentId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

export default function FragmentDetail({
  fragmentId,
  onClose,
  onNavigate,
}: Props) {
  const [data, setData] = useState<FragmentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/map/fragment/${fragmentId}`)
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [fragmentId]);

  return (
    <aside className="map-detail">
      <div className="map-detail-header">
        <h2 className="map-detail-title">Fragment Detail</h2>
        <button className="map-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      {loading ? (
        <p className="map-detail-loading">Loading...</p>
      ) : !data ? (
        <p className="map-detail-loading">Not found</p>
      ) : (
        <div className="map-detail-body">
          {/* Title */}
          <h3 className="map-detail-doc-title">
            {data.documentTitle || "Untitled"}
          </h3>
          <p className="map-detail-submitter">{data.submitterName}</p>

          {/* Cluster */}
          {data.clusterLabel && (
            <p className="map-detail-cluster">
              Cluster: {data.clusterLabel}
            </p>
          )}

          {/* Tags */}
          {data.tags.length > 0 && (
            <div className="map-detail-tags">
              {data.tags.map((t) => (
                <span key={t} className="map-detail-tag">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="map-detail-content">{data.content}</div>

          {/* Source link */}
          {data.documentUrl && (
            <a
              href={data.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="map-detail-link"
            >
              View source &rarr;
            </a>
          )}

          {/* Nearest neighbors */}
          {data.nearestNeighbors.length > 0 && (
            <div className="map-detail-neighbors">
              <h4 className="map-detail-neighbors-title">
                Nearest Neighbors
              </h4>
              <ul className="map-detail-neighbors-list">
                {data.nearestNeighbors.map((n) => (
                  <li key={n.id} className="map-detail-neighbor">
                    <button
                      className="map-detail-neighbor-btn"
                      onClick={() => onNavigate(n.id)}
                    >
                      <span className="map-detail-neighbor-name">
                        {n.submitterName}
                      </span>
                      <span className="map-detail-neighbor-content">
                        {n.content.slice(0, 100)}
                        {n.content.length > 100 ? "..." : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
