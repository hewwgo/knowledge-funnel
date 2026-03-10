"use client";

import { useEffect, useState } from "react";

interface FunnelStatusData {
  total_submissions: number;
  contributor_count: number;
  days_remaining: number;
  cycle_number: number;
  cycle_target: number;
}

export default function FunnelStatus() {
  const [status, setStatus] = useState<FunnelStatusData | null>(null);

  useEffect(() => {
    fetch("/api/funnel-status")
      .then((res) => res.json())
      .then(setStatus)
      .catch(console.error);
  }, []);

  if (!status) {
    return (
      <div className="funnel-status">
        <p style={{ color: "#ffffff", fontSize: "14px" }}>Loading...</p>
      </div>
    );
  }

  const progress = Math.min(
    (status.total_submissions / status.cycle_target) * 100,
    100
  );

  return (
    <div className="funnel-status">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span style={{ color: "#ffffff", fontSize: "14px", fontWeight: 500 }}>
          Cycle {status.cycle_number} &mdash; {status.total_submissions} items
          from {status.contributor_count} contributors &mdash;{" "}
          {status.days_remaining} days remaining
        </span>
      </div>
      <div
        style={{
          width: "100%",
          height: "6px",
          backgroundColor: "rgba(255,255,255,0.2)",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            backgroundColor: "#ffffff",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <div
        style={{
          textAlign: "right",
          marginTop: "4px",
          fontSize: "12px",
          color: "rgba(255,255,255,0.6)",
        }}
      >
        {status.total_submissions} / {status.cycle_target}
      </div>
    </div>
  );
}
