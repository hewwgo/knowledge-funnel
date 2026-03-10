import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractText } from "unpdf";

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

  // Extract text from PDF
  let extractedText = "";
  let extractedTitle = "";
  try {
    const { text } = await extractText(buffer);
    extractedText = Array.isArray(text) ? text.join("\n") : (text || "");

    // Use first non-empty line as title guess
    const lines = extractedText
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 3);
    if (lines.length > 0) {
      extractedTitle = lines[0].slice(0, 200);
    }
  } catch (err) {
    console.error("PDF text extraction failed:", err);
  }

  return NextResponse.json({
    file_path: fileName,
    file_name: file.name,
    extracted_title: extractedTitle,
    extracted_text: extractedText,
  });
}
