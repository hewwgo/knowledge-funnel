import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabaseAdmin();

  // Get current collecting cycle
  const { data: cycle } = await supabase
    .from("cycles")
    .select("*")
    .eq("status", "collecting")
    .order("cycle_number", { ascending: false })
    .limit(1)
    .single();

  if (!cycle) {
    return NextResponse.json({
      total_papers: 0,
      contributor_count: 0,
      days_remaining: 0,
      cycle_number: 0,
    });
  }

  // Count only papers in this cycle (notes/ideas are bonus context)
  const { count: totalPapers } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("cycle_id", cycle.id)
    .eq("content_type", "paper");

  // Count distinct contributors
  const { data: contributors } = await supabase
    .from("submissions")
    .select("profile_id")
    .eq("cycle_id", cycle.id);

  const uniqueContributors = new Set(
    contributors?.map((c) => c.profile_id)
  ).size;

  // Calculate days remaining (7-day collection period)
  const startDate = new Date(cycle.started_at);
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  return NextResponse.json({
    total_papers: totalPapers || 0,
    contributor_count: uniqueContributors,
    days_remaining: daysRemaining,
    cycle_number: cycle.cycle_number,
  });
}
