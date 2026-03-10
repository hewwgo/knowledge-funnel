"use client";

import { useState, useEffect, useRef } from "react";

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
}: {
  onSubmitted: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedName, setSelectedName] = useState<string>("");
  const [contentType, setContentType] = useState<ContentType>("paper");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profiles")
      .then((res) => res.json())
      .then((data: Profile[]) => {
        setProfiles(data);
        // Restore from localStorage
        const savedId = localStorage.getItem("funnel_profile_id");
        const savedName = localStorage.getItem("funnel_profile_name");
        if (savedId && data.some((p) => p.id === savedId)) {
          setSelectedProfileId(savedId);
          setSelectedName(savedName || "");
        }
      })
      .catch(console.error);
  }, []);

  const handleProfileChange = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    setSelectedProfileId(profileId);
    setSelectedName(profile?.name || "");
    if (profileId) {
      localStorage.setItem("funnel_profile_id", profileId);
      localStorage.setItem("funnel_profile_name", profile?.name || "");
    }
  };

  const clearProfile = () => {
    setSelectedProfileId("");
    setSelectedName("");
    localStorage.removeItem("funnel_profile_id");
    localStorage.removeItem("funnel_profile_name");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfileId || !body.trim()) return;

    setSubmitting(true);

    try {
      let filePath: string | null = null;

      // Upload PDF if present
      if (file && contentType === "paper") {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          filePath = uploadData.file_path;
        }
      }

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
        setFile(null);
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

  return (
    <div className="submission-form-wrapper">
      <form onSubmit={handleSubmit}>
        {/* Name selector */}
        {!selectedProfileId ? (
          <div style={{ marginBottom: "20px" }}>
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
        ) : null}

        {selectedProfileId && (
          <>
            {/* Type selector */}
            <div style={{ marginBottom: "20px" }}>
              <label className="form-label">Type</label>
              <div className="type-selector">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`type-btn ${contentType === type ? "type-btn-active" : ""}`}
                    onClick={() => setContentType(type)}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div style={{ marginBottom: "20px" }}>
              <label className="form-label">Title</label>
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
              <label className="form-label">Content</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={PLACEHOLDERS[contentType]}
                className="form-textarea"
                rows={5}
                required
              />
            </div>

            {/* PDF upload — only for papers */}
            {contentType === "paper" && (
              <div style={{ marginBottom: "20px" }}>
                <label className="form-label">Upload PDF</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="form-file"
                />
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="submit-btn"
            >
              {submitting ? "Dropping..." : "Drop it in"}
            </button>

            {/* Success message */}
            {successMsg && <p className="success-msg">Added to the funnel &#10003;</p>}
          </>
        )}
      </form>
    </div>
  );
}
