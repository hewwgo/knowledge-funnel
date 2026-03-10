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

type FormState = "landing" | "uploading" | "editing" | "sucking" | "profile";
type InputMode = "pdf" | "url" | "text";

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
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState<FormState>("landing");
  const [showThought, setShowThought] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("pdf");
  const [urlValue, setUrlValue] = useState("");
  const [textValue, setTextValue] = useState("");
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
    setFormState("uploading");

    try {
      const storagePath = `${Date.now()}-${file.name}`;
      const { error: uploadError } = await getSupabase().storage
        .from("funnel-uploads")
        .upload(storagePath, file, { contentType: "application/pdf" });

      if (uploadError) {
        console.error("Storage upload failed:", uploadError);
        setFormState("landing");
        return;
      }

      setFilePath(storagePath);

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
      setFormState("editing");
    } catch (err) {
      console.error("Upload failed:", err);
      setFormState("landing");
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
    setTitle("");
    setAbstract("");
    setKeywords([]);
    setThought("");
    setShowThought(false);
    setUrlValue("");
    setTextValue("");
    setFormState("landing");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUrlSubmit = async () => {
    if (!urlValue.trim() || !selectedProfileId) return;
    setSubmitting(true);
    setFormState("sucking");
    await new Promise((r) => setTimeout(r, 600));
    try {
      await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: selectedProfileId,
          content_type: "url",
          title: urlValue.trim(),
          body: urlValue.trim(),
          file_path: null,
        }),
      });
      clearAll();
      onSubmitted();
    } catch (err) {
      console.error("URL submission failed:", err);
      setFormState("landing");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!textValue.trim() || !selectedProfileId) return;
    setSubmitting(true);
    setFormState("sucking");
    await new Promise((r) => setTimeout(r, 600));
    try {
      await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: selectedProfileId,
          content_type: "thought",
          title: null,
          body: textValue.trim(),
          file_path: null,
        }),
      });
      clearAll();
      onSubmitted();
    } catch (err) {
      console.error("Text submission failed:", err);
      setFormState("landing");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfileId) return;
    if (!abstract.trim() && !thought.trim()) return;

    setSubmitting(true);
    setFormState("sucking");

    // Wait for animation
    await new Promise((r) => setTimeout(r, 600));

    try {
      const submissions: Array<{
        profile_id: string;
        content_type: string;
        title: string | null;
        body: string;
        file_path: string | null;
      }> = [];

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

      if (thought.trim()) {
        submissions.push({
          profile_id: selectedProfileId,
          content_type: "thought",
          title: title.trim() ? `On: ${title.trim()}` : null,
          body: thought.trim(),
          file_path: null,
        });
      }

      for (const sub of submissions) {
        await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub),
        });
      }

      clearAll();
      onSubmitted();
    } catch (err) {
      console.error("Submission failed:", err);
      setFormState("editing");
    } finally {
      setSubmitting(false);
    }
  };

  // Hidden file input (always present)
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf"
      onChange={handleFileInput}
      style={{ display: "none" }}
    />
  );

  // Profile selection
  if (!selectedProfileId) {
    return (
      <div className="center-form">
        {fileInput}
        <div className="profile-select-box">
          <label className="form-label" style={{ color: "#888", marginBottom: "8px" }}>
            Who are you?
          </label>
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
      </div>
    );
  }

  // Landing state: tabs + content
  if (formState === "landing") {
    return (
      <div className="center-form">
        {fileInput}
        <div className="landing-box">
          <div className="input-tabs">
            <button
              type="button"
              className={`input-tab${inputMode === "pdf" ? " input-tab-active" : ""}`}
              onClick={() => setInputMode("pdf")}
            >
              PDF
            </button>
            <button
              type="button"
              className={`input-tab${inputMode === "url" ? " input-tab-active" : ""}`}
              onClick={() => setInputMode("url")}
            >
              URL
            </button>
            <button
              type="button"
              className={`input-tab${inputMode === "text" ? " input-tab-active" : ""}`}
              onClick={() => setInputMode("text")}
            >
              Text
            </button>
          </div>

          <div className="input-tab-content">
            {inputMode === "pdf" && (
              <div className="drop-zone">
                <p className="drop-zone-text">Drop a PDF here</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="drop-zone-browse"
                >
                  or browse
                </button>
              </div>
            )}

            {inputMode === "url" && (
              <div className="url-input-zone">
                <input
                  type="url"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  placeholder="Paste a link..."
                  className="url-input"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUrlSubmit();
                  }}
                />
                <button
                  type="button"
                  onClick={handleUrlSubmit}
                  disabled={!urlValue.trim() || submitting}
                  className="submit-btn-small"
                >
                  Drop it in
                </button>
              </div>
            )}

            {inputMode === "text" && (
              <div className="text-input-zone">
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Share a thought, idea, or note..."
                  className="text-input"
                  rows={3}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleTextSubmit}
                  disabled={!textValue.trim() || submitting}
                  className="submit-btn-small"
                >
                  Drop it in
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Uploading state: spinner
  if (formState === "uploading") {
    return (
      <div className="center-form">
        {fileInput}
        <div className="upload-spinner-container">
          <div className="upload-spinner" />
          <p className="upload-spinner-text">Extracting...</p>
        </div>
      </div>
    );
  }

  // Editing / Sucking state: paper card + thought + submit
  return (
    <div className="center-form">
      {fileInput}
      <div className={`edit-card${formState === "sucking" ? " edit-card-sucking" : ""}`}>
        {/* Paper info */}
        <div className="edit-card-paper">
          <h3 className="edit-card-title">{title || "Untitled"}</h3>
          {keywords.length > 0 && (
            <div className="edit-card-keywords">
              {keywords.map((kw, i) => (
                <span key={i} className="keyword-tag">{kw}</span>
              ))}
            </div>
          )}
          <button type="button" onClick={clearAll} className="edit-card-remove">
            remove
          </button>
        </div>

        {/* Thought toggle */}
        <form onSubmit={handleSubmit}>
          {!showThought ? (
            <button
              type="button"
              onClick={() => setShowThought(true)}
              className="thought-toggle"
            >
              + add a thought
            </button>
          ) : (
            <div className="thought-area">
              <textarea
                value={thought}
                onChange={(e) => setThought(e.target.value)}
                placeholder="Why is this interesting? Any ideas?"
                className="thought-input"
                rows={3}
                autoFocus
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || (!abstract.trim() && !thought.trim())}
            className="submit-btn"
          >
            {submitting ? "..." : "Drop it in"}
          </button>
        </form>
      </div>
    </div>
  );
}
