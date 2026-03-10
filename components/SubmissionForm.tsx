"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
}

interface Profile {
  id: string;
  name: string;
}

export default function SubmissionForm({
  onSubmitted,
  droppedFile,
  onFileConsumed,
}: {
  onSubmitted: () => void;
  droppedFile: File | null;
  onFileConsumed: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [thought, setThought] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profiles")
      .then((res) => res.json())
      .then((data: Profile[]) => {
        setProfiles(data);
        const savedId = localStorage.getItem("funnel_profile_id");
        if (savedId && data.some((p) => p.id === savedId)) {
          setSelectedProfileId(savedId);
        }
      })
      .catch(console.error);
  }, []);

  const handleProfileChange = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    setSelectedProfileId(profileId);
    if (profileId) {
      localStorage.setItem("funnel_profile_id", profileId);
      localStorage.setItem("funnel_profile_name", profile?.name || "");
    }
  };

  const uploadAndExtract = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) return;
    setUploading(true);

    try {
      const storagePath = `${Date.now()}-${file.name}`;
      const { error: uploadError } = await getSupabase().storage
        .from("funnel-uploads")
        .upload(storagePath, file, { contentType: "application/pdf" });

      if (uploadError) {
        console.error("Storage upload failed:", uploadError);
        return;
      }

      setFilePath(storagePath);
      setFileName(file.name);

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: storagePath }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.title) setTitle(data.title);
        if (data.abstract) setAbstract(data.abstract);
        if (data.keywords) setKeywords(data.keywords);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, []);

  useEffect(() => {
    if (droppedFile) {
      uploadAndExtract(droppedFile);
      onFileConsumed();
    }
  }, [droppedFile, uploadAndExtract, onFileConsumed]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAndExtract(file);
  };

  const clearAll = () => {
    setFilePath(null);
    setFileName(null);
    setTitle("");
    setAbstract("");
    setKeywords([]);
    setThought("");
    setShowDetails(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfileId) return;
    if (!abstract.trim() && !thought.trim()) return;

    setSubmitting(true);

    try {
      const submissions: Array<{
        profile_id: string;
        content_type: string;
        title: string | null;
        body: string;
        file_path: string | null;
      }> = [];

      // Paper submission (from PDF)
      if (abstract.trim()) {
        let paperBody = abstract.trim();
        if (keywords.length > 0) {
          paperBody += `\n\nKeywords: ${keywords.join(", ")}`;
        }
        submissions.push({
          profile_id: selectedProfileId,
          content_type: "paper",
          title: title.trim() || null,
          body: paperBody,
          file_path: filePath,
        });
      }

      // Thought submission (optional)
      if (thought.trim()) {
        submissions.push({
          profile_id: selectedProfileId,
          content_type: "thought",
          title: title.trim() ? `On: ${title.trim()}` : null,
          body: thought.trim(),
          file_path: null,
        });
      }

      // Submit all
      for (const sub of submissions) {
        await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub),
        });
      }

      clearAll();
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 3000);
      onSubmitted();
    } catch (err) {
      console.error("Submission failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedProfileId) {
    return (
      <div className="submission-form-wrapper">
        <label className="form-label">Your name</label>
        <select
          value={selectedProfileId}
          onChange={(e) => handleProfileChange(e.target.value)}
          className="form-select"
        >
          <option value="">Select your name...</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="submission-form-wrapper">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileInput}
        style={{ display: "none" }}
      />

      {/* Upload status */}
      {uploading && (
        <div className="upload-status">
          Uploading &amp; extracting metadata...
        </div>
      )}

      {/* Compact paper card (after upload) */}
      {fileName && !uploading && (
        <div className="paper-card">
          <div className="paper-card-header">
            <div className="paper-card-info">
              <span className="paper-card-title">{title || fileName}</span>
              {keywords.length > 0 && (
                <div className="keywords-row" style={{ marginTop: "8px", marginBottom: 0 }}>
                  {keywords.map((kw, i) => (
                    <span key={i} className="keyword-tag">{kw}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="paper-card-actions">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="paper-card-toggle"
              >
                {showDetails ? "hide details" : "show details"}
              </button>
              <button type="button" onClick={clearAll} className="file-banner-clear">
                remove
              </button>
            </div>
          </div>

          {/* Expandable details */}
          {showDetails && (
            <div className="paper-card-details">
              <div style={{ marginBottom: "12px" }}>
                <label className="form-label">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">Abstract</label>
                <textarea
                  value={abstract}
                  onChange={(e) => setAbstract(e.target.value)}
                  className="form-textarea"
                  rows={6}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drop hint + browse (before upload) */}
      {!filePath && !uploading && (
        <div className="pdf-drop-hint">
          <p className="pdf-drop-hint-text">
            Drag &amp; drop a PDF anywhere on this page
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="browse-link"
          >
            or browse for a PDF
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Single thought field */}
        <div style={{ marginBottom: "20px" }}>
          <label className="form-label">Add a thought (optional)</label>
          <textarea
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            placeholder="Why is this interesting? Did it spark an idea?"
            className="form-textarea"
            rows={3}
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={
            submitting ||
            uploading ||
            (!abstract.trim() && !thought.trim())
          }
          className="submit-btn"
        >
          {submitting ? "Dropping..." : "Drop it in"}
        </button>

        {successMsg && (
          <p className="success-msg">Added to the funnel &#10003;</p>
        )}
      </form>
    </div>
  );
}
