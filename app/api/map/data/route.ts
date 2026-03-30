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

    // 1. Fetch projections with submission + profile data
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
        nodes: [],
        clusters: [],
        researchers: [],
        computedAt: null,
      });
    }

    // 2. Fetch concept labels for each submission (for tooltips)
    const { data: conceptLinks } = await supabase
      .from("submission_concepts")
      .select("submission_id, concepts!inner(label)");

    const conceptsBySubmission = new Map<string, string[]>();
    const conceptFrequency = new Map<string, number>(); // corpus-wide frequency
    for (const link of conceptLinks || []) {
      const subId = link.submission_id;
      const label = (link.concepts as unknown as { label: string })?.label;
      if (!label) continue;
      if (!conceptsBySubmission.has(subId)) {
        conceptsBySubmission.set(subId, []);
      }
      conceptsBySubmission.get(subId)!.push(label);
      conceptFrequency.set(label, (conceptFrequency.get(label) || 0) + 1);
    }
    const totalSubmissions = projections?.length || 1;

    // 3. Fetch cluster labels
    const { data: clusterLabelsData } = await supabase
      .from("cluster_labels")
      .select("cluster_id, label");
    const clusterLabelMap = new Map<number, string>();
    for (const cl of clusterLabelsData || []) {
      clusterLabelMap.set(cl.cluster_id, cl.label);
    }

    // 4. Build researcher color map + nodes
    const researcherMap = new Map<string, { id: string; name: string; color: string; submissionCount: number }>();
    let colorIndex = 0;

    const nodes = projections.map((p: Record<string, unknown>) => {
      const sub = p.submissions as unknown as {
        id: string;
        title: string;
        body: string;
        content_type: string;
        profile_id: string;
        created_at: string;
        profiles: { id: string; name: string };
      };
      const profile = sub.profiles;

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
      researcher.submissionCount++;

      return {
        id: sub.id,
        title: sub.title || "(untitled)",
        body: (sub.body || "").slice(0, 300),
        contentType: sub.content_type,
        x: p.x as number,
        y: p.y as number,
        clusterId: p.cluster_id as number | null,
        submitterId: profile.id,
        submitterName: profile.name,
        submitterColor: researcher.color,
        concepts: conceptsBySubmission.get(sub.id) || [],
        distinctiveConcepts: (conceptsBySubmission.get(sub.id) || [])
          .filter((c) => {
            const freq = conceptFrequency.get(c) || 0;
            // Concept appears in less than 30% of submissions = distinctive
            return freq <= Math.max(2, totalSubmissions * 0.3);
          })
          .sort((a, b) => (conceptFrequency.get(a) || 0) - (conceptFrequency.get(b) || 0)),
        createdAt: sub.created_at,
      };
    });

    // 5. Build clusters array with centroids
    const clusterGroups = new Map<number, typeof nodes>();
    for (const n of nodes) {
      if (n.clusterId === null || n.clusterId === undefined || n.clusterId === -1) continue;
      if (!clusterGroups.has(n.clusterId)) clusterGroups.set(n.clusterId, []);
      clusterGroups.get(n.clusterId)!.push(n);
    }

    const clusters = Array.from(clusterGroups.entries()).map(([id, members]) => ({
      id,
      label: clusterLabelMap.get(id) || "Unlabeled",
      points: members.map((m) => [m.x, m.y] as [number, number]),
      centroidX: members.reduce((sum, m) => sum + m.x, 0) / members.length,
      centroidY: members.reduce((sum, m) => sum + m.y, 0) / members.length,
      memberCount: members.length,
      submitterIds: [...new Set(members.map((m) => m.submitterId))],
    }));

    // 6. Build concept hub nodes (positioned at centroid of their submissions)
    const conceptHubs: {
      id: string; label: string; x: number; y: number;
      submissionCount: number; isHub: true;
    }[] = [];
    const conceptEdges: {
      from: string; to: string; type: "concept-link";
    }[] = [];

    // Only create hubs for concepts shared by 2+ submissions
    for (const [label, freq] of conceptFrequency) {
      if (freq < 2) continue;

      // Find all submissions with this concept
      const memberNodes = nodes.filter((n: { concepts: string[] }) =>
        n.concepts.includes(label)
      );
      if (memberNodes.length < 2) continue;

      // Position hub at centroid of its members
      const hubX = memberNodes.reduce((s: number, n: { x: number }) => s + n.x, 0) / memberNodes.length;
      const hubY = memberNodes.reduce((s: number, n: { y: number }) => s + n.y, 0) / memberNodes.length;

      const hubId = `concept-${label.replace(/\s+/g, "-")}`;
      conceptHubs.push({
        id: hubId,
        label,
        x: hubX,
        y: hubY,
        submissionCount: memberNodes.length,
        isHub: true,
      });

      // Create edges from hub to each member submission
      for (const mn of memberNodes) {
        conceptEdges.push({ from: hubId, to: (mn as { id: string }).id, type: "concept-link" });
      }
    }

    return NextResponse.json({
      nodes,
      clusters,
      researchers: Array.from(researcherMap.values()),
      conceptHubs,
      conceptEdges,
      computedAt: projections[0]?.computed_at || null,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Map data error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
