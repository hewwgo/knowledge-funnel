import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractText } from "unpdf";
import { extractPaperMetadata } from "@/lib/llm";

export const maxDuration = 60;

// This endpoint now only handles extraction — the file is already in Supabase Storage.
// It downloads the PDF from storage, extracts text, and runs LLM metadata extraction.
export async function POST(request: NextRequest) {
  const { file_path } = await request.json();

  if (!file_path) {
    return NextResponse.json({ error: "file_path is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Download file from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("funnel-uploads")
    .download(file_path);

  if (downloadError || !fileData) {
    return NextResponse.json(
      { error: downloadError?.message || "Failed to download file" },
      { status: 500 }
    );
  }

  const buffer = new Uint8Array(await fileData.arrayBuffer());

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

  return NextResponse.json({ title, abstract, keywords });
}
