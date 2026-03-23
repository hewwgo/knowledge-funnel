import { NextResponse } from "next/server";
import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { systemPrompt, userPrompt } = await request.json();

    if (!systemPrompt || !userPrompt) {
      return NextResponse.json(
        { error: "systemPrompt and userPrompt are required" },
        { status: 400 }
      );
    }

    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const text = response.choices[0]?.message?.content || "";
    return NextResponse.json({ text });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Explore LLM error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
