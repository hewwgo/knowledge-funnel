import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { anonymize } from "@/lib/anonymize";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const anonymized = (data || []).map((p: { id: string; name: string }) => ({
    ...p,
    name: anonymize(p.name),
  }));
  return NextResponse.json(anonymized);
}
