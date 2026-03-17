import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, fragmentIds, note, targetClusterId, userId } = body;

    if (!type || !fragmentIds?.length) {
      return NextResponse.json(
        { error: "type and fragmentIds are required" },
        { status: 400 }
      );
    }

    const validTypes = ["flag_connection", "dispute_placement", "seed_convergence"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("map_interactions")
      .insert({
        user_id: userId || null,
        interaction_type: type,
        payload: {
          fragment_ids: fragmentIds,
          note: note || null,
          target_cluster_id: targetClusterId || null,
        },
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, interactionId: data.id });
  } catch (error) {
    console.error("Map interact error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
