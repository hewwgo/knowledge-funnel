import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

export async function extractPaperMetadata(rawText: string): Promise<{
  title: string;
  abstract: string;
  keywords: string[];
}> {
  const truncated = rawText.slice(0, 6000);

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You extract structured metadata from academic paper text. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Extract the title, abstract, and keywords from this paper text. If keywords aren't explicitly listed, infer 3-5 relevant ones from the content.

Return JSON in this exact format:
{"title": "...", "abstract": "...", "keywords": ["...", "..."]}

Paper text:
${truncated}`,
      },
    ],
    temperature: 0,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    // Strip markdown fences if present
    const cleaned = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      title: parsed.title || "",
      abstract: parsed.abstract || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { title: "", abstract: "", keywords: [] };
  }
}

export async function extractUrlMetadata(pageText: string, url: string): Promise<{
  title: string;
  abstract: string;
  keywords: string[];
}> {
  const truncated = pageText.slice(0, 6000);

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You extract structured metadata from web page content. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Extract the title, a concise summary (as "abstract"), and 3-5 keywords from this web page content.

URL: ${url}

Return JSON in this exact format:
{"title": "...", "abstract": "...", "keywords": ["...", "..."]}

Page content:
${truncated}`,
      },
    ],
    temperature: 0,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const cleaned = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      title: parsed.title || "",
      abstract: parsed.abstract || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { title: "", abstract: "", keywords: [] };
  }
}
