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
  const [note, setNote] = useState("");
  const [idea, setIdea] = useState("");
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
    setNote("");
    setIdea("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfileId) return;
    // Need at least an abstract (from PDF) or a note or an idea
    if (!abstract.trim() && !note.trim() && !idea.trim()) return;

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

      // Note submission (optional)
      if (note.trim()) {
        submissions.push({
          profile_id: selectedProfileId,
          content_type: "note",
          title: title.trim() ? `Note on: ${title.trim()}` : null,
          body: note.trim(),
          file_path: null,
        });
      }

      // Idea submission (optional)
      if (idea.trim()) {
        submissions.push({
          profile_id: selectedProfileId,
          content_type: "idea",
          title: title.trim() ? `Idea from: ${title.trim()}` : null,
          body: idea.trim(),
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
      {/* Upload status */}
      {uploading && (
        <div className="upload-status">
          Uploading &amp; extracting metadata...
        </div>
      )}

      {/* File banner */}
      {fileName && !uploading && (
        <div className="file-banner">
          <span className="file-banner-name">{fileName}</span>
          <button type="button" onClick={clearAll} className="file-banner-clear">
            remove
          </button>
        </div>
      )}

      {/* Keywords */}
      {keywords.length > 0 && !uploading && (
        <div className="keywords-row">
          {keywords.map((kw, i) => (
            <span key={i} className="keyword-tag">
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileInput}
        style={{ display: "none" }}
      />

      <form onSubmit={handleSubmit}>
        {/* Title */}
        <div style={{ marginBottom: "20px" }}>
          <label className="form-label">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Paper title (auto-filled from PDF)"
            className="form-input"
          />
        </div>

        {/* Abstract */}
        <div style={{ marginBottom: "20px" }}>
          <label className="form-label">Abstract</label>
          <textarea
            value={abstract}
            onChange={(e) => setAbstract(e.target.value)}
            placeholder="Drop a PDF above, or paste an abstract here"
            className="form-textarea"
            rows={filePath ? 6 : 3}
          />
        </div>

        {/* Note */}
        <div style={{ marginBottom: "20px" }}>
          <label className="form-label">Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any thoughts on this paper? Why is it interesting?"
            className="form-textarea"
            rows={2}
          />
        </div>

        {/* Idea */}
        <div style={{ marginBottom: "20px" }}>
          <label className="form-label">Idea</label>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Did this spark a research idea? Describe it — rough is fine"
            className="form-textarea"
            rows={2}
          />
        </div>

        {/* Browse PDF link when no file yet */}
        {!filePath && !uploading && (
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
          disabled={
            submitting ||
            uploading ||
            (!abstract.trim() && !note.trim() && !idea.trim())
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
