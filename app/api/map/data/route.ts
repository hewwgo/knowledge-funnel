import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// Colorblind-safe palette (Okabe-Ito)
const RESEARCHER_COLORS = [
  "#E69F00", "#56B4E9", "#009E73", "#F0E442",
  "#0072B2", "#D55E00", "#CC79A7", "#999999",
  "#E6AB02", "#66A61E",
];

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch all concepts
    const { data: concepts, error: cErr } = await supabase
      .from("concepts")
      .select("id, label, level");
    if (cErr) throw cErr;
    if (!concepts || concepts.length === 0) {
      return NextResponse.json({
        nodes: [],
        edges: [],
        submissions: [],
        researchers: [],
      });
    }

    // 2. Fetch all submission-concept links with submission + profile
    const { data: links, error: lErr } = await supabase
      .from("submission_concepts")
      .select(`
        concept_id,
        submissions!inner (
          id, title, body, content_type, profile_id, created_at,
          profiles!inner ( id, name )
        )
      `);
    if (lErr) throw lErr;

    // 3. Fetch all edges
    const { data: edges, error: eErr } = await supabase
      .from("concept_edges")
      .select("source_id, target_id, relation, weight");
    if (eErr) throw eErr;

    // 4. Build researcher color map
    const researcherMap = new Map<string, { id: string; name: string; color: string; submissionCount: number }>();
    let colorIndex = 0;

    // 5. Build concept → submissions mapping
    const conceptSubmissions = new Map<string, Set<string>>();
    const conceptResearchers = new Map<string, Set<string>>();
    const submissionMap = new Map<string, {
      id: string;
      title: string;
      body: string;
      contentType: string;
      submitterId: string;
      submitterName: string;
      submitterColor: string;
      concepts: string[];
      createdAt: string;
    }>();

    for (const link of links || []) {
      const sub = link.submissions as unknown as {
        id: string;
        title: string;
        body: string;
        content_type: string;
        profile_id: string;
        created_at: string;
        profiles: { id: string; name: string };
      };
      const profile = sub.profiles;
      const conceptId = link.concept_id;

      // Register researcher
      if (!researcherMap.has(profile.id)) {
        researcherMap.set(profile.id, {
          id: profile.id,
          name: profile.name,
          color: RESEARCHER_COLORS[colorIndex % RESEARCHER_COLORS.length],
          submissionCount: 0,
        });
        colorIndex++;
      }
      const researcher = researcherMap.get(profile.id)!;

      // Track concept → submissions
      if (!conceptSubmissions.has(conceptId)) {
        conceptSubmissions.set(conceptId, new Set());
      }
      conceptSubmissions.get(conceptId)!.add(sub.id);

      // Track concept → researchers
      if (!conceptResearchers.has(conceptId)) {
        conceptResearchers.set(conceptId, new Set());
      }
      conceptResearchers.get(conceptId)!.add(profile.id);

      // Build submission record
      if (!submissionMap.has(sub.id)) {
        researcher.submissionCount++;
        submissionMap.set(sub.id, {
          id: sub.id,
          title: sub.title || "",
          body: (sub.body || "").slice(0, 300),
          contentType: sub.content_type,
          submitterId: profile.id,
          submitterName: profile.name,
          submitterColor: researcher.color,
          concepts: [],
          createdAt: sub.created_at,
        });
      }

      // Add concept label to submission
      const concept = concepts.find((c) => c.id === conceptId);
      if (concept) {
        const existing = submissionMap.get(sub.id)!;
        if (!existing.concepts.includes(concept.label)) {
          existing.concepts.push(concept.label);
        }
      }
    }

    // 6. Build nodes array
    const nodes = concepts
      .filter((c) => conceptSubmissions.has(c.id))
      .map((c) => {
        const researcherIds = Array.from(conceptResearchers.get(c.id) || []);
        const researcherColors = researcherIds
          .map((rid) => researcherMap.get(rid)?.color || "#999999");

        return {
          id: c.id,
          label: c.label,
          level: (c as { level?: string }).level || "specific",
          submissionCount: conceptSubmissions.get(c.id)?.size || 0,
          researcherIds,
          researcherColors,
          isShared: researcherIds.length > 1,
        };
      });

    // 7. Build edges array
    const nodeIds = new Set(nodes.map((n) => n.id));
    const graphEdges = (edges || [])
      .filter((e) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
      .map((e) => ({
        source: e.source_id,
        target: e.target_id,
        relation: e.relation || "co-occurs",
        weight: e.weight || 1,
      }));

    return NextResponse.json({
      nodes,
      edges: graphEdges,
      submissions: Array.from(submissionMap.values()),
      researchers: Array.from(researcherMap.values()),
    });
  } catch (error) {
    console.error("Map data error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
