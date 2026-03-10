"use client";

import { useState, useEffect, useCallback } from "react";
import FunnelStatus from "@/components/FunnelStatus";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionList from "@/components/SubmissionList";
import VoidFunnel from "@/components/VoidFunnel";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedName, setSelectedName] = useState<string>("");
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem("funnel_profile_name");
    if (name) setSelectedName(name);
  }, []);

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
    <div className="page-root">
      {/* Wormhole background */}
      <VoidFunnel />

      {/* Drag overlay */}
      {dragOver && (
        <div className="drag-overlay">
          <p className="drag-overlay-text">Drop PDF here</p>
        </div>
      )}

      {/* UI layer */}
      <div className="ui-layer">
        {/* Status bar */}
        <FunnelStatus />

        {/* Top-left: user info + submissions */}
        <div className="corner-panel">
          <div className="corner-header">
            <span className="corner-title">Twin Agent Incubator</span>
            {selectedName && (
              <span className="corner-user">
                {selectedName}
                <button onClick={handleChangeName}>change</button>
              </span>
            )}
          </div>
          <SubmissionList refreshKey={refreshKey} />
        </div>

        {/* Center stage: the drop zone / form */}
        <div className="center-stage">
          <SubmissionForm
            onSubmitted={handleSubmitted}
            droppedFile={droppedFile}
            onFileConsumed={handleFileConsumed}
          />
        </div>
      </div>
    </div>
  );
}
