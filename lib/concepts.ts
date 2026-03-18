import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

/**
 * Extract key research concepts and relationships from a submission.
 * Returns normalized (lowercased, trimmed) concept labels and typed relationships.
 */
export async function extractConcepts(
  title: string,
  body: string
): Promise<{
  concepts: string[];
  relationships: { from: string; to: string; relation: string }[];
}> {
  const text = `${title || ""}\n\n${body || ""}`.trim().slice(0, 4000);

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You extract key research concepts and their relationships from academic content. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Extract 3-7 key concepts and relationships from this research content.

Concepts should be specific enough to be meaningful but general enough to overlap with other researchers' work. Think: research topics, methods, domains, technologies, theoretical frameworks.

Use short phrases (1-3 words). Normalize to lowercase.

Return JSON in this exact format:
{"concepts": ["concept1", "concept2"], "relationships": [{"from": "concept1", "to": "concept2", "relation": "uses"}]}

Relationship types: "uses", "extends", "applied to", "enables", "contrasts with", "part of", "evaluates"

Content:
${text}`,
      },
    ],
    temperature: 0,
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content || "";
  try {
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      concepts: Array.isArray(parsed.concepts)
        ? parsed.concepts.map((c: string) => String(c).toLowerCase().trim()).filter(Boolean)
        : [],
      relationships: Array.isArray(parsed.relationships)
        ? parsed.relationships
            .filter(
              (r: { from?: string; to?: string; relation?: string }) =>
                r.from && r.to && r.relation
            )
            .map((r: { from: string; to: string; relation: string }) => ({
              from: r.from.toLowerCase().trim(),
              to: r.to.toLowerCase().trim(),
              relation: r.relation.toLowerCase().trim(),
            }))
        : [],
    };
  } catch {
    return { concepts: [], relationships: [] };
  }
}
