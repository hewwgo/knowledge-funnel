import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

export async function POST(req: Request) {
  try {
    const { clusterId } = await req.json();
    if (clusterId === undefined || clusterId === null) {
      return NextResponse.json({ error: "clusterId required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Get all submissions in this cluster
    const { data: projections, error: projErr } = await supabase
      .from("projection_cache")
      .select(`
        submission_id,
        submissions!inner (
          id, title, body, content_type, profile_id,
          profiles!inner ( id, name )
        )
      `)
      .eq("cluster_id", clusterId);

    if (projErr) throw projErr;
    if (!projections || projections.length === 0) {
      return NextResponse.json({ bridge: "No submissions in this cluster." });
    }

    // Group by researcher
    const byResearcher = new Map<string, { name: string; submissions: { title: string; body: string }[] }>();
    for (const p of projections) {
      const sub = p.submissions as unknown as {
        id: string; title: string; body: string; content_type: string;
        profile_id: string; profiles: { id: string; name: string };
      };
      const profile = sub.profiles;
      if (!byResearcher.has(profile.id)) {
        byResearcher.set(profile.id, { name: profile.name, submissions: [] });
      }
      byResearcher.get(profile.id)!.submissions.push({
        title: sub.title || "(untitled)",
        body: (sub.body || "").slice(0, 400),
      });
    }

    const researchers = Array.from(byResearcher.values());

    // If only one researcher, no bridge needed
    if (researchers.length < 2) {
      return NextResponse.json({
        bridge: `This cluster contains ${projections.length} submissions, all from ${researchers[0].name}. No cross-researcher overlap yet.`,
      });
    }

    // Build context for LLM
    const researcherSummaries = researchers.map((r) => {
      const titles = r.submissions.map((s) => `"${s.title}"`).join(", ");
      return `${r.name} contributed: ${titles}`;
    });

    const submissionDetails = projections.slice(0, 8).map((p) => {
      const sub = p.submissions as unknown as {
        title: string; body: string; profiles: { name: string };
      };
      return `[${sub.profiles.name}] "${sub.title}": ${(sub.body || "").slice(0, 200)}`;
    });

    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "You identify common ground between researchers based on their submissions to a shared knowledge base. Be specific and insightful. Write in 2-3 sentences max.",
        },
        {
          role: "user",
          content: `These researchers have submissions clustered together in a knowledge map, meaning their work is semantically similar:

${researcherSummaries.join("\n")}

Submission details:
${submissionDetails.join("\n\n")}

Write a brief bridge statement (2-3 sentences) that:
1. Names the shared research territory these researchers occupy
2. Notes how their approaches or perspectives differ
3. Suggests what a collaboration between them might explore

Be specific to their actual work, not generic.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const bridge = response.choices[0]?.message?.content?.trim() || "Could not generate bridge summary.";

    return NextResponse.json({ bridge });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Bridge generation error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
