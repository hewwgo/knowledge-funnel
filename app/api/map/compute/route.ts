import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateEmbeddings, generateClusterLabel } from "@/lib/embeddings";
import { UMAP } from "umap-js";

// Simple k-means clustering — always produces k clusters, every point assigned
function kmeans(points: number[][], k: number, maxIter = 50): number[] {
  const n = points.length;
  if (n <= k) return points.map((_, i) => i); // each point is its own cluster

  // Initialize centroids using k-means++ for better spread
  const centroids: number[][] = [];
  centroids.push([...points[Math.floor(Math.random() * n)]]);

  for (let c = 1; c < k; c++) {
    const dists = points.map((p) => {
      const minDist = Math.min(...centroids.map((cen) => {
        const dx = p[0] - cen[0], dy = p[1] - cen[1];
        return dx * dx + dy * dy;
      }));
      return minDist;
    });
    const totalDist = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push([...points[i]]); break; }
    }
    if (centroids.length === c) centroids.push([...points[Math.floor(Math.random() * n)]]);
  }

  const labels = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = points[i][0] - centroids[c][0];
        const dy = points[i][1] - centroids[c][1];
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestCluster = c; }
      }
      if (labels[i] !== bestCluster) { labels[i] = bestCluster; changed = true; }
    }

    if (!changed) break;

    // Recompute centroids
    for (let c = 0; c < k; c++) {
      const members = points.filter((_, i) => labels[i] === c);
      if (members.length === 0) continue;
      centroids[c][0] = members.reduce((s, p) => s + p[0], 0) / members.length;
      centroids[c][1] = members.reduce((s, p) => s + p[1], 0) / members.length;
    }
  }

  return labels;
}

// Choose k based on number of submissions (sqrt heuristic, capped)
function chooseK(n: number): number {
  if (n <= 5) return 2;
  if (n <= 15) return 3;
  if (n <= 30) return 4;
  if (n <= 60) return 5;
  return Math.min(8, Math.ceil(Math.sqrt(n)));
}

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch all submissions with profiles
    const { data: submissions, error: fetchError } = await supabase
      .from("submissions")
      .select("id, title, body, content_type, profile_id, embedding")
      .order("created_at", { ascending: true });

    if (fetchError) throw fetchError;
    if (!submissions || submissions.length === 0) {
      return NextResponse.json(
        { error: "No submissions to process" },
        { status: 400 }
      );
    }

    // 2. Embed any submissions that don't have embeddings yet
    const needsEmbedding = submissions.filter((s) => !s.embedding);
    if (needsEmbedding.length > 0) {
      const texts = needsEmbedding.map(
        (s) => `${s.title || ""}\n\n${(s.body || "").slice(0, 2000)}`.trim()
      );
      const embeddings = await generateEmbeddings(texts);

      for (let i = 0; i < needsEmbedding.length; i++) {
        const sub = needsEmbedding[i];
        const emb = embeddings[i];
        if (emb) {
          await supabase
            .from("submissions")
            .update({ embedding: JSON.stringify(emb) })
            .eq("id", sub.id);
          sub.embedding = emb as unknown as string;
        }
      }
    }

    // 3. Filter to only submissions with valid embeddings
    const withEmbeddings = submissions.filter((s) => s.embedding);
    if (withEmbeddings.length < 2) {
      return NextResponse.json({
        success: true,
        message: "Need at least 2 submissions with embeddings",
        submissionCount: submissions.length,
        embeddedCount: withEmbeddings.length,
      });
    }

    // Parse embeddings — they might be stored as JSON strings or arrays
    const embeddingVectors: number[][] = withEmbeddings.map((s) => {
      if (typeof s.embedding === "string") {
        return JSON.parse(s.embedding);
      }
      return s.embedding as unknown as number[];
    });

    // 4. Run UMAP projection (1024-dim → 2D)
    const nNeighbors = Math.min(15, Math.max(2, withEmbeddings.length - 1));
    const umap = new UMAP({
      nNeighbors,
      minDist: 0.1,
      nComponents: 2,
      spread: 1.0,
    });

    const projected: number[][] = umap.fit(embeddingVectors);

    // 5. Normalize to [0, 1000] coordinate space
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of projected) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 50;
    const scale = 1000 - 2 * padding;

    const normalized = projected.map(([x, y]) => [
      padding + ((x - minX) / rangeX) * scale,
      padding + ((y - minY) / rangeY) * scale,
    ]);

    // 6. Run k-means clustering on 2D coordinates
    const k = chooseK(withEmbeddings.length);
    const clusterAssignments = kmeans(normalized, k);

    // 7. Clear old projections and write new ones
    await supabase.from("projection_cache").delete().neq("submission_id", "00000000-0000-0000-0000-000000000000");

    const projections = withEmbeddings.map((s, i) => ({
      submission_id: s.id,
      x: Math.round(normalized[i][0]),
      y: Math.round(normalized[i][1]),
      cluster_id: clusterAssignments[i],
      computed_at: new Date().toISOString(),
    }));

    // Insert in batches to avoid payload limits
    for (let i = 0; i < projections.length; i += 50) {
      const batch = projections.slice(i, i + 50);
      const { error: insertErr } = await supabase
        .from("projection_cache")
        .upsert(batch, { onConflict: "submission_id" });
      if (insertErr) throw insertErr;
    }

    // 8. Generate cluster labels (parallel to stay within timeout)
    const clusterIds = [...new Set(clusterAssignments)];
    await supabase.from("cluster_labels").delete().neq("cluster_id", -999);

    await Promise.all(
      clusterIds.map(async (clusterId) => {
        const memberIndices = clusterAssignments
          .map((c, i) => (c === clusterId ? i : -1))
          .filter((i) => i >= 0);

        const memberTexts = memberIndices.map((i) => {
          const s = withEmbeddings[i];
          return `${s.title || ""}: ${(s.body || "").slice(0, 300)}`;
        });

        const label = await generateClusterLabel(memberTexts.slice(0, 5));

        const representativeIds = memberIndices
          .slice(0, 3)
          .map((i) => withEmbeddings[i].id);

        await supabase.from("cluster_labels").upsert(
          {
            cluster_id: clusterId,
            label,
            representative_submission_ids: representativeIds,
          },
          { onConflict: "cluster_id" }
        );
      })
    );

    return NextResponse.json({
      success: true,
      submissionCount: submissions.length,
      embeddedCount: withEmbeddings.length,
      projectedCount: projections.length,
      clusterCount: clusterIds.length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Map compute error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
