import { NextRequest, NextResponse } from "next/server";
import { sendDiscordNotification } from "@/lib/discord";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, contentType, totalCount, contributorCount } = body;

  await sendDiscordNotification({
    name,
    contentType,
    totalCount,
    contributorCount,
  });

  return NextResponse.json({ ok: true });
}
