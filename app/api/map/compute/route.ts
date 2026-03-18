import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractConcepts } from "@/lib/concepts";

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch all submissions
    const { data: submissions, error: fetchError } = await supabase
      .from("submissions")
      .select("id, title, body, content_type, profile_id")
      .order("created_at", { ascending: true });

    if (fetchError) throw fetchError;
    if (!submissions || submissions.length === 0) {
      return NextResponse.json(
        { error: "No submissions to process" },
        { status: 400 }
      );
    }

    // 2. Find which submissions already have concepts extracted
    const { data: existingLinks } = await supabase
      .from("submission_concepts")
      .select("submission_id");
    const processedIds = new Set(
      (existingLinks || []).map((l: { submission_id: string }) => l.submission_id)
    );

    const needsExtraction = submissions.filter((s) => !processedIds.has(s.id));

    // 3. Extract concepts for unprocessed submissions
    let newConcepts = 0;
    let newEdges = 0;

    for (const sub of needsExtraction) {
      const result = await extractConcepts(sub.title || "", sub.body || "");

      if (result.concepts.length === 0) continue;

      // Upsert each concept
      const conceptIds: Map<string, string> = new Map();
      for (const label of result.concepts) {
        // Try to find existing concept
        const { data: existing } = await supabase
          .from("concepts")
          .select("id")
          .eq("label", label)
          .single();

        if (existing) {
          conceptIds.set(label, existing.id);
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("concepts")
            .insert({ label })
            .select("id")
            .single();
          if (insertErr) {
            // Might be a race condition / duplicate — try fetching again
            const { data: retry } = await supabase
              .from("concepts")
              .select("id")
              .eq("label", label)
              .single();
            if (retry) conceptIds.set(label, retry.id);
            continue;
          }
          if (inserted) {
            conceptIds.set(label, inserted.id);
            newConcepts++;
          }
        }
      }

      // Link submission to concepts
      const links = Array.from(conceptIds.values()).map((conceptId) => ({
        submission_id: sub.id,
        concept_id: conceptId,
      }));
      if (links.length > 0) {
        await supabase
          .from("submission_concepts")
          .upsert(links, { onConflict: "submission_id,concept_id" });
      }

      // Create/update edges between co-occurring concepts
      const conceptLabels = Array.from(conceptIds.keys());
      for (let i = 0; i < conceptLabels.length; i++) {
        for (let j = i + 1; j < conceptLabels.length; j++) {
          const sourceId = conceptIds.get(conceptLabels[i])!;
          const targetId = conceptIds.get(conceptLabels[j])!;

          // Find explicit relationship if one exists
          const rel = result.relationships.find(
            (r) =>
              (r.from === conceptLabels[i] && r.to === conceptLabels[j]) ||
              (r.from === conceptLabels[j] && r.to === conceptLabels[i])
          );

          // Upsert edge — increment weight if it already exists
          const { data: existingEdge } = await supabase
            .from("concept_edges")
            .select("id, weight")
            .or(
              `and(source_id.eq.${sourceId},target_id.eq.${targetId}),and(source_id.eq.${targetId},target_id.eq.${sourceId})`
            )
            .single();

          if (existingEdge) {
            await supabase
              .from("concept_edges")
              .update({
                weight: (existingEdge.weight || 1) + 1,
                relation: rel?.relation || "co-occurs",
              })
              .eq("id", existingEdge.id);
          } else {
            const { error: edgeErr } = await supabase
              .from("concept_edges")
              .insert({
                source_id: sourceId,
                target_id: targetId,
                relation: rel?.relation || "co-occurs",
                weight: 1,
              });
            if (!edgeErr) newEdges++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      submissionCount: submissions.length,
      processed: needsExtraction.length,
      newConcepts,
      newEdges,
    });
  } catch (error) {
    console.error("Map compute error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
