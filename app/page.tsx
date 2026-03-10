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
  }, []);

  // All drag/drop on document level — must preventDefault on dragover
  // for drop to fire, and use capture phase to beat the browser default
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file && file.name.toLowerCase().endsWith(".pdf")) {
        setDroppedFile(file);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      // Only hide overlay when leaving the document entirely
      if (e.relatedTarget === null) {
        setDragOver(false);
      }
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragleave", handleDragLeave);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragleave", handleDragLeave);
    };
  }, [dragOver]);

  const handleSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1);
    const name = localStorage.getItem("funnel_profile_name");
    if (name) setSelectedName(name);
  }, []);

  const handleChangeName = () => {
    localStorage.removeItem("funnel_profile_id");
    localStorage.removeItem("funnel_profile_name");
    setSelectedName("");
    setRefreshKey((k) => k + 1);
  };

  const handleFileConsumed = useCallback(() => {
    setDroppedFile(null);
  }, []);

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
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
