import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  generateEmbeddings,
  generateTags,
  generateClusterLabel,
} from "@/lib/embeddings";
import { UMAP } from "umap-js";
// @ts-expect-error - dbscan has no type declarations
import { DBSCAN } from "dbscan";

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch all submissions with content
    const { data: submissions, error: fetchError } = await supabase
      .from("submissions")
      .select("id, title, body, content_type, profile_id, embedding")
      .order("created_at", { ascending: true });

    if (fetchError) throw fetchError;
    if (!submissions || submissions.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 submissions to compute map" },
        { status: 400 }
      );
    }

    // 2. Generate embeddings for submissions that don't have them yet
    const needsEmbedding = submissions.filter((s) => !s.embedding);
    if (needsEmbedding.length > 0) {
      const texts = needsEmbedding.map(
        (s) => `${s.title || ""}\n\n${s.body || ""}`.trim()
      );
      const embeddings = await generateEmbeddings(texts);

      // Write embeddings back to submissions
      for (let i = 0; i < needsEmbedding.length; i++) {
        const { error: updateError } = await supabase
          .from("submissions")
          .update({ embedding: JSON.stringify(embeddings[i]) })
          .eq("id", needsEmbedding[i].id);
        if (updateError) {
          console.error("Embedding update error:", updateError);
        }
      }

      // Update local data with new embeddings
      for (let i = 0; i < needsEmbedding.length; i++) {
        const sub = submissions.find((s) => s.id === needsEmbedding[i].id);
        if (sub) sub.embedding = embeddings[i];
      }
    }

    // 3. Generate tags for untagged submissions
    const { data: existingTags } = await supabase
      .from("submission_tags")
      .select("submission_id");
    const taggedIds = new Set(
      (existingTags || []).map((t: { submission_id: string }) => t.submission_id)
    );
    const needsTags = submissions.filter((s) => !taggedIds.has(s.id));

    if (needsTags.length > 0) {
      // Process in chunks of 10
      for (let i = 0; i < needsTags.length; i += 10) {
        const chunk = needsTags.slice(i, i + 10);
        const tagResults = await Promise.all(
          chunk.map((s) =>
            generateTags(`${s.title || ""}\n\n${s.body || ""}`.trim())
          )
        );
        for (let j = 0; j < chunk.length; j++) {
          const tags = tagResults[j];
          if (tags.length > 0) {
            await supabase.from("submission_tags").insert(
              tags.map((t) => ({
                submission_id: chunk[j].id,
                tag: t.tag,
                confidence: t.confidence,
              }))
            );
          }
        }
      }
    }

    // 4. Build embedding matrix for UMAP
    const embeddingMatrix = submissions.map((s) => {
      if (Array.isArray(s.embedding)) return s.embedding as number[];
      if (typeof s.embedding === "string") return JSON.parse(s.embedding);
      return new Array(1024).fill(0);
    });

    // 5. Run UMAP
    const umap = new UMAP({
      nNeighbors: Math.min(15, Math.floor(submissions.length / 2)),
      minDist: 0.1,
      nComponents: 2,
      random: () => 0.42, // fixed seed for determinism
    });
    const projection = umap.fit(embeddingMatrix);

    // 6. Normalize coordinates to [0, 1000]
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [x, y] of projection) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const normalized = projection.map(([x, y]: number[]) => [
      ((x - minX) / rangeX) * 1000,
      ((y - minY) / rangeY) * 1000,
    ]);

    // 7. Run DBSCAN clustering on 2D coordinates
    const epsilon = 50; // ~5% of the 1000-unit range
    const minPoints = 2;
    const dbscan = new DBSCAN();
    const clusters: number[][] = dbscan.run(normalized, epsilon, minPoints);

    // Build cluster assignment array (-1 = noise)
    const clusterAssignments = new Array(submissions.length).fill(-1);
    clusters.forEach((cluster: number[], clusterId: number) => {
      cluster.forEach((pointIndex: number) => {
        clusterAssignments[pointIndex] = clusterId;
      });
    });

    // 8. Clear old projection and cluster data, then write new
    await supabase.from("projection_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("cluster_labels").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert projection cache
    const projectionRows = submissions.map((s, i) => ({
      submission_id: s.id,
      x: normalized[i][0],
      y: normalized[i][1],
      cluster_id: clusterAssignments[i],
    }));
    const { error: projError } = await supabase
      .from("projection_cache")
      .insert(projectionRows);
    if (projError) throw projError;

    // 9. Generate cluster labels
    const clusterCount = clusters.length;
    for (let cid = 0; cid < clusterCount; cid++) {
      const memberIndices = clusters[cid];
      const centroidX =
        memberIndices.reduce((sum: number, i: number) => sum + normalized[i][0], 0) /
        memberIndices.length;
      const centroidY =
        memberIndices.reduce((sum: number, i: number) => sum + normalized[i][1], 0) /
        memberIndices.length;

      // Find 3-5 representatives closest to centroid
      const withDist = memberIndices.map((i: number) => ({
        index: i,
        dist: Math.hypot(normalized[i][0] - centroidX, normalized[i][1] - centroidY),
      }));
      withDist.sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist);
      const reps = withDist.slice(0, 5);
      const repTexts = reps.map(
        (r: { index: number }) =>
          `${submissions[r.index].title || ""}\n${submissions[r.index].body || ""}`.trim()
      );
      const repIds = reps.map((r: { index: number }) => submissions[r.index].id);

      const label = await generateClusterLabel(repTexts);

      await supabase.from("cluster_labels").insert({
        cluster_id: cid,
        label,
        representative_submission_ids: repIds,
      });
    }

    return NextResponse.json({
      success: true,
      submissionCount: submissions.length,
      clusterCount,
      newEmbeddings: needsEmbedding.length,
      newTags: needsTags.length,
    });
  } catch (error) {
    console.error("Map compute error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
