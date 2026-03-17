import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch the submission with profile
    const { data: submission, error } = await supabase
      .from("submissions")
      .select("id, title, body, content_type, file_path, embedding, created_at, profiles!inner(id, name)")
      .eq("id", id)
      .single();

    if (error || !submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Fetch tags
    const { data: tags } = await supabase
      .from("submission_tags")
      .select("tag")
      .eq("submission_id", id);

    // Fetch cluster info
    const { data: projection } = await supabase
      .from("projection_cache")
      .select("cluster_id")
      .eq("submission_id", id)
      .single();

    let clusterLabel: string | null = null;
    if (projection && projection.cluster_id !== null && projection.cluster_id !== -1) {
      const { data: cl } = await supabase
        .from("cluster_labels")
        .select("label")
        .eq("cluster_id", projection.cluster_id)
        .single();
      clusterLabel = cl?.label || null;
    }

    // Nearest neighbors via pgvector cosine distance
    let nearestNeighbors: { id: string; content: string; submitterName: string; distance: number }[] = [];
    if (submission.embedding) {
      const embeddingStr =
        typeof submission.embedding === "string"
          ? submission.embedding
          : JSON.stringify(submission.embedding);

      const { data: neighbors } = await supabase.rpc("match_submissions", {
        query_embedding: embeddingStr,
        match_count: 6,
      });

      if (neighbors) {
        nearestNeighbors = neighbors
          .filter((n: { id: string }) => n.id !== id)
          .slice(0, 5)
          .map((n: { id: string; body: string; name: string; distance: number }) => ({
            id: n.id,
            content: (n.body || "").slice(0, 200),
            submitterName: n.name || "Unknown",
            distance: n.distance,
          }));
      }
    }

    const profile = submission.profiles as unknown as { id: string; name: string };

    return NextResponse.json({
      id: submission.id,
      content: submission.body || "",
      submitterName: profile.name,
      documentTitle: submission.title || "",
      documentUrl: submission.file_path || null,
      tags: (tags || []).map((t: { tag: string }) => t.tag),
      clusterId: projection?.cluster_id ?? null,
      clusterLabel,
      nearestNeighbors,
    });
  } catch (error) {
    console.error("Fragment detail error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
