import { NextRequest, NextResponse } from "next/server";
import { extractUrlMetadata } from "@/lib/llm";

export const maxDuration = 60;

// Fetches a URL, strips HTML to plain text, and runs LLM extraction
export async function POST(request: NextRequest) {
  const { url } = await request.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Fetch the page
  let html = "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KnowledgeFunnel/1.0; +https://knowledge-funnel.vercel.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${res.status}` },
        { status: 502 }
      );
    }

    html = await res.text();
  } catch (err) {
    console.error("URL fetch failed:", err);
    return NextResponse.json(
      { error: "Could not fetch the URL" },
      { status: 502 }
    );
  }

  // Strip HTML to plain text
  const plainText = htmlToPlainText(html);

  if (plainText.length < 30) {
    return NextResponse.json(
      { title: "", abstract: "", keywords: [] },
      { status: 200 }
    );
  }

  // Run LLM extraction
  let title = "";
  let abstract = "";
  let keywords: string[] = [];

  try {
    const metadata = await extractUrlMetadata(plainText, url);
    title = metadata.title;
    abstract = metadata.abstract;
    keywords = metadata.keywords;
  } catch (err) {
    console.error("LLM extraction for URL failed:", err);
  }

  // Fallback title from <title> tag
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim().slice(0, 200);
    }
  }

  return NextResponse.json({ title, abstract, keywords });
}

/** Naive but effective HTML → plain text */
function htmlToPlainText(html: string): string {
  // Remove script, style, nav, header, footer blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
