"use client";

import { useState, useEffect } from "react";
import FunnelStatus from "@/components/FunnelStatus";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionList from "@/components/SubmissionList";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedName, setSelectedName] = useState<string>("");

  useEffect(() => {
    const name = localStorage.getItem("funnel_profile_name");
    if (name) setSelectedName(name);

    const handleStorage = () => {
      const updated = localStorage.getItem("funnel_profile_name");
      setSelectedName(updated || "");
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const handleSubmitted = () => {
    setRefreshKey((k) => k + 1);
    // Re-check name in case it was just set
    const name = localStorage.getItem("funnel_profile_name");
    if (name) setSelectedName(name);
  };

  const handleChangeName = () => {
    localStorage.removeItem("funnel_profile_id");
    localStorage.removeItem("funnel_profile_name");
    setSelectedName("");
    setRefreshKey((k) => k + 1);
  };

  return (
    <div>
      {/* Status bar — full width */}
      <FunnelStatus />

      {/* Content — centered column */}
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "0 24px 64px",
        }}
      >
        {/* Header */}
        <div className="header">
          <span className="header-title">Twin Agent Incubator</span>
          {selectedName && (
            <span className="header-user">
              {selectedName}
              <button onClick={handleChangeName}>change</button>
            </span>
          )}
        </div>

        {/* Submission Form */}
        <div style={{ marginBottom: "40px" }}>
          <SubmissionForm onSubmitted={handleSubmitted} />
        </div>

        {/* User's Submissions */}
        <SubmissionList refreshKey={refreshKey} />
      </div>
    </div>
  );
}
