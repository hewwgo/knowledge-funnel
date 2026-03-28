import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { title, description, grounding, facetPath } = await request.json();

    if (!title || !description) {
      return NextResponse.json(
        { error: "title and description are required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Build body with grounding and facet path
    const bodyParts: string[] = [description];

    if (grounding && grounding.length > 0) {
      bodyParts.push("\n---\nGrounded in:");
      for (const g of grounding) {
        bodyParts.push(`• ${g.seed}: ${g.contribution}`);
      }
    }

    if (facetPath) {
      bodyParts.push(`\n---\nFacet path: ${facetPath}`);
    }

    // Use a generic "Explorer" profile for web-generated ideas
    // First check if it exists, create if not
    let profileId: string;
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("name", "Tessera Explorer")
      .single();

    if (existing) {
      profileId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("profiles")
        .insert({ name: "Tessera Explorer" })
        .select("id")
        .single();
      if (createErr) throw createErr;
      profileId = created!.id;
    }

    // Get current cycle
    const { data: cycle } = await supabase
      .from("cycles")
      .select("id")
      .eq("status", "collecting")
      .order("cycle_number", { ascending: false })
      .limit(1)
      .single();

    // Create submission
    const { data: submission, error: subErr } = await supabase
      .from("submissions")
      .insert({
        profile_id: profileId,
        content_type: "idea",
        title,
        body: bodyParts.join("\n"),
        cycle_id: cycle?.id || null,
      })
      .select("id")
      .single();

    if (subErr) throw subErr;

    return NextResponse.json({
      success: true,
      submissionId: submission!.id,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Save idea error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
