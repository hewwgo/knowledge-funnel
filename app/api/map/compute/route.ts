import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateEmbeddings, generateClusterLabel } from "@/lib/embeddings";
import { UMAP } from "umap-js";

// Simple DBSCAN implementation (the npm package has an incompatible API)
function dbscan(points: number[][], epsilon: number, minPoints: number): number[] {
  const n = points.length;
  const labels = new Array(n).fill(-1); // -1 = noise
  let clusterId = 0;

  function dist(a: number[], b: number[]) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function regionQuery(idx: number): number[] {
    const neighbors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (dist(points[idx], points[i]) <= epsilon) neighbors.push(i);
    }
    return neighbors;
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPoints) continue; // noise

    labels[i] = clusterId;
    const queue = [...neighbors.filter((j) => j !== i)];
    const visited = new Set([i]);

    while (queue.length > 0) {
      const j = queue.shift()!;
      if (visited.has(j)) continue;
      visited.add(j);

      if (labels[j] === -1) labels[j] = clusterId; // was noise, claim it
      if (labels[j] !== -1 && labels[j] !== clusterId) continue; // already in another cluster

      labels[j] = clusterId;
      const jNeighbors = regionQuery(j);
      if (jNeighbors.length >= minPoints) {
        for (const k of jNeighbors) {
          if (!visited.has(k)) queue.push(k);
        }
      }
    }
    clusterId++;
  }

  return labels;
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

    // 6. Run DBSCAN clustering on 2D coordinates
    const epsilon = 80;
    const minPoints = 2;
    const clusterAssignments = dbscan(normalized, epsilon, minPoints);

    // 7. Clear old projections and write new ones
    await supabase.from("projection_cache").delete().neq("submission_id", "00000000-0000-0000-0000-000000000000");

    const projections = withEmbeddings.map((s, i) => ({
      submission_id: s.id,
      x: Math.round(normalized[i][0]),
      y: Math.round(normalized[i][1]),
      cluster_id: clusterAssignments[i] >= 0 ? clusterAssignments[i] : null,
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

    // 8. Generate cluster labels
    const clusterIds = [...new Set(clusterAssignments.filter((c) => c >= 0))];
    await supabase.from("cluster_labels").delete().neq("cluster_id", -999);

    for (const clusterId of clusterIds) {
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
    }

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
