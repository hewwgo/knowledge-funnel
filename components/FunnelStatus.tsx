"use client";

import { useEffect, useState } from "react";

interface FunnelStatusData {
  total_papers: number;
  contributor_count: number;
  days_remaining: number;
  cycle_number: number;
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

  return (
    <div className="funnel-status">
      <span style={{ color: "#ffffff", fontSize: "14px", fontWeight: 500 }}>
        Cycle {status.cycle_number} &mdash; {status.total_papers} paper
        {status.total_papers !== 1 ? "s" : ""} from{" "}
        {status.contributor_count} contributor
        {status.contributor_count !== 1 ? "s" : ""} &mdash;{" "}
        {status.days_remaining} day{status.days_remaining !== 1 ? "s" : ""}{" "}
        remaining
      </span>
    </div>
  );
}
