import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

export interface ExtractedConcept {
  label: string;
  level: "broad" | "specific";
}

export interface ExtractedRelationship {
  from: string;
  to: string;
  relation: string;
}

/**
 * Extract hierarchical research concepts and relationships from a submission.
 * Returns broad (research fields) and specific (methods/techniques) concepts,
 * plus only meaningful semantic relationships (not all-pairs).
 */
export async function extractConcepts(
  title: string,
  body: string
): Promise<{
  concepts: ExtractedConcept[];
  relationships: ExtractedRelationship[];
}> {
  const text = `${title || ""}\n\n${body || ""}`.trim().slice(0, 4000);

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You extract hierarchical research concepts from academic content. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Extract key concepts from this research content at two levels:

BROAD (1-2 concepts): High-level research fields or domains that many researchers might share. Examples: "human-computer interaction", "machine learning", "natural language processing", "computer vision". Use 1-3 words.

SPECIFIC (3-5 concepts): Narrower methods, techniques, applications, or topics unique to this work. Examples: "eye tracking", "transformer architecture", "prompt engineering", "crowdsourcing". Use 1-4 words.

Also identify meaningful semantic relationships between concepts. Only include relationships that represent genuine connections, NOT every possible pair. Max 5 relationships.

Return JSON in this exact format:
{"concepts": [{"label": "machine learning", "level": "broad"}, {"label": "transfer learning", "level": "specific"}], "relationships": [{"from": "transfer learning", "to": "machine learning", "relation": "part of"}]}

Relationship types: "uses", "extends", "applied to", "enables", "contrasts with", "part of", "evaluates"

Normalize all concept labels to lowercase.

Content:
${text}`,
      },
    ],
    temperature: 0,
    max_tokens: 600,
  });

  const content = response.choices[0]?.message?.content || "";
  try {
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const concepts: ExtractedConcept[] = Array.isArray(parsed.concepts)
      ? parsed.concepts
          .map((c: { label?: string; level?: string } | string) => {
            if (typeof c === "string") {
              return { label: c.toLowerCase().trim(), level: "specific" as const };
            }
            return {
              label: String(c.label || "").toLowerCase().trim(),
              level: c.level === "broad" ? ("broad" as const) : ("specific" as const),
            };
          })
          .filter((c: ExtractedConcept) => c.label.length > 0)
      : [];

    const relationships: ExtractedRelationship[] = Array.isArray(parsed.relationships)
      ? parsed.relationships
          .filter(
            (r: { from?: string; to?: string; relation?: string }) =>
              r.from && r.to && r.relation
          )
          .slice(0, 5)
          .map((r: { from: string; to: string; relation: string }) => ({
            from: r.from.toLowerCase().trim(),
            to: r.to.toLowerCase().trim(),
            relation: r.relation.toLowerCase().trim(),
          }))
      : [];

    return { concepts, relationships };
  } catch {
    return { concepts: [], relationships: [] };
  }
}
