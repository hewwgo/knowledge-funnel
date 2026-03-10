"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Profile {
  id: string;
  name: string;
}

const CONTENT_TYPES = ["paper", "link", "note", "idea"] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

const PLACEHOLDERS: Record<ContentType, string> = {
  paper: "Paste the title, abstract, or a link to the paper",
  link: "Paste the URL and a brief note on why it\u2019s interesting",
  note: "What\u2019s on your mind?",
  idea: "Describe the idea \u2014 rough is fine",
};

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
  const [contentType, setContentType] = useState<ContentType>("paper");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
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
    setContentType("paper");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setFilePath(data.file_path);
        setFileName(data.file_name);
        if (data.extracted_title) {
          setTitle(data.extracted_title);
        }
        if (data.extracted_text) {
          setBody(data.extracted_text.slice(0, 8000));
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, []);

  // Handle file dropped at page level
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

  const clearFile = () => {
    setFilePath(null);
    setFileName(null);
    setTitle("");
    setBody("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfileId || !body.trim()) return;

    setSubmitting(true);

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: selectedProfileId,
          content_type: contentType,
          title: title.trim() || null,
          body: body.trim(),
          file_path: filePath,
        }),
      });

      if (res.ok) {
        setTitle("");
        setBody("");
        setFilePath(null);
        setFileName(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setSuccessMsg(true);
        setTimeout(() => setSuccessMsg(false), 3000);
        onSubmitted();
      }
    } catch (err) {
      console.error("Submission failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // If no profile selected, show just the dropdown
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
      {/* Upload status / file info */}
      {uploading && (
        <div className="upload-status">Extracting content from PDF...</div>
      )}

      {fileName && !uploading && (
        <div className="file-banner">
          <span className="file-banner-name">{fileName}</span>
          <button type="button" onClick={clearFile} className="file-banner-clear">
            remove
          </button>
        </div>
      )}

      {/* Hidden file input for click-to-browse fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileInput}
        style={{ display: "none" }}
      />

      {/* Form */}
      <form onSubmit={handleSubmit}>
        {/* Type selector */}
        <div style={{ marginBottom: "20px" }}>
          <div className="type-selector">
            {CONTENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`type-btn ${contentType === type ? "type-btn-active" : ""}`}
                onClick={() => {
                  setContentType(type);
                  if (!filePath) {
                    setTitle("");
                    setBody("");
                  }
                }}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div style={{ marginBottom: "20px" }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give it a short label (optional)"
            className="form-input"
          />
        </div>

        {/* Content */}
        <div style={{ marginBottom: "20px" }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={PLACEHOLDERS[contentType]}
            className="form-textarea"
            rows={filePath ? 8 : 4}
            required
          />
        </div>

        {/* Browse PDF link — only for paper type when no file yet */}
        {contentType === "paper" && !filePath && (
          <div style={{ marginBottom: "20px" }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="browse-link"
            >
              or browse for a PDF
            </button>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || uploading || !body.trim()}
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
