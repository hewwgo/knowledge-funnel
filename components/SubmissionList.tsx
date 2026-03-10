"use client";

import { useEffect, useState } from "react";

interface Submission {
  id: string;
  content_type: string;
  title: string | null;
  body: string;
  created_at: string;
}

interface SubmissionGroup {
  paper: Submission | null;
  children: Submission[];
  timestamp: string;
}

function groupSubmissions(submissions: Submission[]): SubmissionGroup[] {
  // Submissions come sorted by created_at desc.
  // Group items submitted within 5 seconds of each other (same form submit).
  const groups: SubmissionGroup[] = [];
  let current: SubmissionGroup | null = null;

  // Process in chronological order for grouping, then reverse
  const sorted = [...submissions].reverse();

  for (const sub of sorted) {
    const ts = new Date(sub.created_at).getTime();

    if (
      current &&
      Math.abs(ts - new Date(current.timestamp).getTime()) < 5000
    ) {
      // Same group
      if (sub.content_type === "paper") {
        current.paper = sub;
      } else {
        current.children.push(sub);
      }
    } else {
      // New group
      current = {
        paper: sub.content_type === "paper" ? sub : null,
        children: sub.content_type !== "paper" ? [sub] : [],
        timestamp: sub.created_at,
      };
      groups.push(current);
    }
  }

  return groups.reverse();
}

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

  const groups = groupSubmissions(submissions);

  return (
    <div className="submissions-list">
      <h2 className="section-title">Your submissions</h2>
      {groups.length === 0 ? (
        <p className="muted-text">
          You haven&apos;t added anything yet. Drop something in &mdash; it
          takes 30 seconds.
        </p>
      ) : (
        <ul className="submission-items">
          {groups.map((group, gi) => (
            <li key={gi} className="submission-group">
              {/* Paper row — prominent */}
              {group.paper && (
                <div className="submission-item submission-paper">
                  <span className="submission-type">Paper</span>
                  <span className="submission-text submission-paper-title">
                    {group.paper.title || group.paper.body.slice(0, 120)}
                    {!group.paper.title && group.paper.body.length > 120 ? "..." : ""}
                  </span>
                  <span className="submission-time">
                    {new Date(group.paper.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
              {/* Note/Idea rows — indented */}
              {group.children.map((child) => (
                <div
                  key={child.id}
                  className={`submission-item submission-child${!group.paper ? " submission-standalone" : ""}`}
                >
                  <span className="submission-type">
                    {child.content_type === "idea" ? "Idea" : "Note"}
                  </span>
                  <span className="submission-text">
                    {child.body.slice(0, 80)}
                    {child.body.length > 80 ? "..." : ""}
                  </span>
                  {!group.paper && (
                    <span className="submission-time">
                      {new Date(child.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
