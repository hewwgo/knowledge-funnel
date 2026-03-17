import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

interface MapFragment {
  id: unknown;
  content: string;
  fullContent: string;
  submitterId: string;
  submitterName: string;
  submitterColor: string;
  documentTitle: string;
  x: number;
  y: number;
  clusterId: number | null;
  tags: string[];
  createdAt: unknown;
}

// Colorblind-safe palette (Okabe-Ito)
const RESEARCHER_COLORS = [
  "#E69F00", "#56B4E9", "#009E73", "#F0E442",
  "#0072B2", "#D55E00", "#CC79A7", "#999999",
  "#E6AB02", "#66A61E",
];

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch projections with submission + profile data
    const { data: projections, error: projError } = await supabase
      .from("projection_cache")
      .select(`
        submission_id, x, y, cluster_id, computed_at,
        submissions!inner (
          id, title, body, content_type, profile_id, created_at,
          profiles!inner ( id, name )
        )
      `)
      .order("computed_at", { ascending: false });

    if (projError) throw projError;
    if (!projections || projections.length === 0) {
      return NextResponse.json({
        fragments: [],
        clusters: [],
        researchers: [],
        computedAt: null,
      });
    }

    // Fetch all tags
    const { data: allTags } = await supabase
      .from("submission_tags")
      .select("submission_id, tag");
    const tagsBySubmission = new Map<string, string[]>();
    for (const t of allTags || []) {
      const existing = tagsBySubmission.get(t.submission_id) || [];
      existing.push(t.tag);
      tagsBySubmission.set(t.submission_id, existing);
    }

    // Fetch cluster labels
    const { data: clusterLabelsData } = await supabase
      .from("cluster_labels")
      .select("cluster_id, label, representative_submission_ids");
    const clusterLabelMap = new Map<number, string>();
    for (const cl of clusterLabelsData || []) {
      clusterLabelMap.set(cl.cluster_id, cl.label);
    }

    // Build researcher color map
    const researcherMap = new Map<string, { id: string; name: string; color: string; fragmentCount: number }>();
    let colorIndex = 0;

    // Build fragments array
    const fragments: MapFragment[] = projections.map((p: Record<string, unknown>) => {
      const sub = p.submissions as Record<string, unknown>;
      const profile = sub.profiles as { id: string; name: string };

      if (!researcherMap.has(profile.id)) {
        researcherMap.set(profile.id, {
          id: profile.id,
          name: profile.name,
          color: RESEARCHER_COLORS[colorIndex % RESEARCHER_COLORS.length],
          fragmentCount: 0,
        });
        colorIndex++;
      }
      const researcher = researcherMap.get(profile.id)!;
      researcher.fragmentCount++;

      const body = (sub.body as string) || "";

      return {
        id: sub.id,
        content: body.slice(0, 200),
        fullContent: body,
        submitterId: profile.id,
        submitterName: profile.name,
        submitterColor: researcher.color,
        documentTitle: (sub.title as string) || "",
        x: p.x as number,
        y: p.y as number,
        clusterId: p.cluster_id as number | null,
        tags: tagsBySubmission.get(sub.id as string) || [],
        createdAt: sub.created_at,
      };
    });

    // Build clusters array
    const clusterGroups = new Map<number, MapFragment[]>();
    for (const f of fragments) {
      const cid = f.clusterId as number;
      if (cid === null || cid === undefined || cid === -1) continue;
      const existing = clusterGroups.get(cid) || [];
      existing.push(f);
      clusterGroups.set(cid, existing);
    }

    const clusters = Array.from(clusterGroups.entries()).map(([id, members]) => ({
      id,
      label: clusterLabelMap.get(id) || "Unlabeled",
      centroidX: members.reduce((sum, m) => sum + m.x, 0) / members.length,
      centroidY: members.reduce((sum, m) => sum + m.y, 0) / members.length,
      memberCount: members.length,
      submitterIds: [...new Set(members.map((m) => m.submitterId))],
    }));

    return NextResponse.json({
      fragments,
      clusters,
      researchers: Array.from(researcherMap.values()),
      computedAt: projections[0]?.computed_at || null,
    });
  } catch (error) {
    console.error("Map data error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
