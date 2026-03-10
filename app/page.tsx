"use client";

import { useState, useEffect, useCallback } from "react";
import FunnelStatus from "@/components/FunnelStatus";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionList from "@/components/SubmissionList";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedName, setSelectedName] = useState<string>("");
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

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

  // Prevent browser default drop behavior globally
  useEffect(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("dragover", preventDefaults);
    window.addEventListener("drop", preventDefaults);
    return () => {
      window.removeEventListener("dragover", preventDefaults);
      window.removeEventListener("drop", preventDefaults);
    };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".pdf")) {
      setDroppedFile(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only set false if actually leaving the page container
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleSubmitted = () => {
    setRefreshKey((k) => k + 1);
    const name = localStorage.getItem("funnel_profile_name");
    if (name) setSelectedName(name);
  };

  const handleChangeName = () => {
    localStorage.removeItem("funnel_profile_id");
    localStorage.removeItem("funnel_profile_name");
    setSelectedName("");
    setRefreshKey((k) => k + 1);
  };

  const handleFileConsumed = () => {
    setDroppedFile(null);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{ minHeight: "100vh", position: "relative" }}
    >
      {/* Full-page drag overlay */}
      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <p className="drag-overlay-text">Drop PDF here</p>
          </div>
        </div>
      )}

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
          <SubmissionForm
            onSubmitted={handleSubmitted}
            droppedFile={droppedFile}
            onFileConsumed={handleFileConsumed}
          />
        </div>

        {/* User's Submissions */}
        <SubmissionList refreshKey={refreshKey} />
      </div>
    </div>
  );
}
