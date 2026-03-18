import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractConcepts } from "@/lib/concepts";

export const maxDuration = 60;

const BATCH_SIZE = 2;

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

    if (needsExtraction.length === 0) {
      return NextResponse.json({
        success: true,
        submissionCount: submissions.length,
        processed: 0,
        remaining: 0,
        newConcepts: 0,
        newEdges: 0,
      });
    }

    // 3. Only process a batch to stay within timeout
    const batch = needsExtraction.slice(0, BATCH_SIZE);
    let newConcepts = 0;
    let newEdges = 0;

    // Pre-fetch all existing concepts to minimize DB round-trips
    const { data: allConcepts } = await supabase
      .from("concepts")
      .select("id, label, level");
    const conceptCache = new Map<string, { id: string; level: string }>();
    for (const c of allConcepts || []) {
      conceptCache.set(c.label, { id: c.id, level: c.level || "specific" });
    }

    for (const sub of batch) {
      const result = await extractConcepts(sub.title || "", sub.body || "");
      if (result.concepts.length === 0) continue;

      // Upsert each concept (use cache first)
      const conceptIds = new Map<string, string>();
      for (const concept of result.concepts) {
        const cached = conceptCache.get(concept.label);
        if (cached) {
          conceptIds.set(concept.label, cached.id);
          // Upgrade to broad if newly classified as broad
          if (concept.level === "broad" && cached.level !== "broad") {
            await supabase
              .from("concepts")
              .update({ level: "broad" })
              .eq("id", cached.id);
            cached.level = "broad";
          }
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("concepts")
            .insert({ label: concept.label, level: concept.level })
            .select("id")
            .single();
          if (insertErr) {
            // Race condition — fetch it
            const { data: retry } = await supabase
              .from("concepts")
              .select("id")
              .eq("label", concept.label)
              .single();
            if (retry) {
              conceptIds.set(concept.label, retry.id);
              conceptCache.set(concept.label, { id: retry.id, level: concept.level });
            }
            continue;
          }
          if (inserted) {
            conceptIds.set(concept.label, inserted.id);
            conceptCache.set(concept.label, { id: inserted.id, level: concept.level });
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

      // Create edges ONLY for LLM-specified relationships (not all-pairs)
      for (const rel of result.relationships) {
        const sourceId = conceptIds.get(rel.from);
        const targetId = conceptIds.get(rel.to);
        if (!sourceId || !targetId || sourceId === targetId) continue;

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
              relation: rel.relation,
            })
            .eq("id", existingEdge.id);
        } else {
          const { error: edgeErr } = await supabase
            .from("concept_edges")
            .insert({
              source_id: sourceId,
              target_id: targetId,
              relation: rel.relation,
              weight: 1,
            });
          if (!edgeErr) newEdges++;
        }
      }
    }

    const remaining = needsExtraction.length - batch.length;
    return NextResponse.json({
      success: true,
      submissionCount: submissions.length,
      processed: batch.length,
      remaining,
      newConcepts,
      newEdges,
    });
  } catch (error) {
    console.error("Map compute error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
