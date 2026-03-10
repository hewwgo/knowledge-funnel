"use client";

import { useEffect, useState } from "react";

interface Submission {
  id: string;
  content_type: string;
  title: string | null;
  body: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  paper: "Paper",
  link: "Link",
  note: "Note",
  idea: "Idea",
};

export default function SubmissionList({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const profileId = localStorage.getItem("funnel_profile_id");
    if (!profileId) {
      setLoading(false);
      return;
    }

    fetch(`/api/submissions?profile_id=${profileId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSubmissions(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="submissions-list">
        <h2 className="section-title">Your submissions</h2>
        <p className="muted-text">Loading...</p>
      </div>
    );
  }

  const profileId = typeof window !== "undefined" ? localStorage.getItem("funnel_profile_id") : null;
  if (!profileId) return null;

  return (
    <div className="submissions-list">
      <h2 className="section-title">Your submissions</h2>
      {submissions.length === 0 ? (
        <p className="muted-text">
          You haven&apos;t added anything yet. Drop something in &mdash; it
          takes 30 seconds.
        </p>
      ) : (
        <ul className="submission-items">
          {submissions.map((sub) => (
            <li key={sub.id} className="submission-item">
              <span className="submission-type">
                {TYPE_LABELS[sub.content_type] || sub.content_type}
              </span>
              <span className="submission-text">
                {sub.title || sub.body.slice(0, 80)}
                {!sub.title && sub.body.length > 80 ? "..." : ""}
              </span>
              <span className="submission-time">
                {new Date(sub.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
