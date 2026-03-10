import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractText } from "unpdf";
import { extractPaperMetadata } from "@/lib/llm";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Only PDF files are accepted" },
      { status: 400 }
    );
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const supabase = getSupabaseAdmin();
  const fileName = `${Date.now()}-${file.name}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("funnel-uploads")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Extract raw text from PDF
  let rawText = "";
  try {
    const { text } = await extractText(buffer);
    rawText = Array.isArray(text) ? text.join("\n") : (text || "");
  } catch (err) {
    console.error("PDF text extraction failed:", err);
  }

  // Use LLM to extract structured metadata
  let title = "";
  let abstract = "";
  let keywords: string[] = [];

  if (rawText.length > 50) {
    try {
      const metadata = await extractPaperMetadata(rawText);
      title = metadata.title;
      abstract = metadata.abstract;
      keywords = metadata.keywords;
    } catch (err) {
      console.error("LLM extraction failed:", err);
    }
  }

  // Fallback: use first line as title if LLM didn't return one
  if (!title) {
    const lines = rawText
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 3);
    if (lines.length > 0) {
      title = lines[0].slice(0, 200);
    }
  }

  return NextResponse.json({
    file_path: fileName,
    file_name: file.name,
    title,
    abstract,
    keywords,
  });
}
