import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = searchParams.get("ids")?.split(",").filter(Boolean);

  if (!ids || ids.length === 0) {
    return NextResponse.json({ seeds: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("submissions")
    .select("id, title, body, content_type")
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const seeds = (data || []).map((s) => ({
    id: s.id,
    title: s.title || "(untitled)",
    body: (s.body || "").slice(0, 500),
    contentType: s.content_type,
  }));

  return NextResponse.json({ seeds });
}
