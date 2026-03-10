import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendDiscordNotification } from "@/lib/discord";

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get("profile_id");
  if (!profileId) {
    return NextResponse.json(
      { error: "profile_id is required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // Get current collecting cycle
  const { data: cycle } = await supabase
    .from("cycles")
    .select("id")
    .eq("status", "collecting")
    .order("cycle_number", { ascending: false })
    .limit(1)
    .single();

  const query = supabase
    .from("submissions")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (cycle) {
    query.eq("cycle_id", cycle.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { profile_id, content_type, title, body: content, file_path } = body;

  if (!profile_id || !content_type || !content) {
    return NextResponse.json(
      { error: "profile_id, content_type, and body are required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // Get current collecting cycle
  const { data: cycle } = await supabase
    .from("cycles")
    .select("id")
    .eq("status", "collecting")
    .order("cycle_number", { ascending: false })
    .limit(1)
    .single();

  // Insert submission
  const { data: submission, error } = await supabase
    .from("submissions")
    .insert({
      profile_id,
      content_type,
      title: title || null,
      body: content,
      file_path: file_path || null,
      cycle_id: cycle?.id || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get profile name for Discord notification
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", profile_id)
    .single();

  // Get cycle stats for Discord footer
  const { count: totalCount } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("cycle_id", cycle?.id);

  const { data: contributors } = await supabase
    .from("submissions")
    .select("profile_id")
    .eq("cycle_id", cycle?.id);

  const uniqueContributors = new Set(
    contributors?.map((c) => c.profile_id)
  ).size;

  // Fire Discord webhook (fire-and-forget)
  sendDiscordNotification({
    name: profile?.name || "Someone",
    contentType: content_type,
    totalCount: totalCount || 1,
    contributorCount: uniqueContributors || 1,
  });

  return NextResponse.json(submission, { status: 201 });
}
