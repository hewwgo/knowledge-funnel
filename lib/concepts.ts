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
  body: string,
  existingConcepts?: string[]
): Promise<{
  concepts: ExtractedConcept[];
  relationships: ExtractedRelationship[];
}> {
  const text = `${title || ""}\n\n${body || ""}`.trim().slice(0, 8000);

  const existingSection = existingConcepts && existingConcepts.length > 0
    ? `\n\nEXISTING CONCEPTS IN THE KNOWLEDGE BASE:\n${existingConcepts.join(", ")}\n\nYou MUST reuse an existing concept if the meaning is similar. Do NOT create "reflective friction" if "reflective design" exists — use the existing one. Only create a new specific concept if nothing in the list above covers it.`
    : "";

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
        content: `Extract key concepts from this research content. Be CONCISE — fewer, broader concepts are better than many narrow ones.

BROAD (exactly 1 concept): The single most fitting high-level research field. STRONGLY prefer these standard labels: "human-computer interaction", "machine learning", "artificial intelligence", "natural language processing", "computer vision", "information retrieval", "data visualization", "robotics", "accessibility", "collaborative systems", "social computing", "ubiquitous computing". Only create a new broad label if none of these fit.

SPECIFIC (1-2 concepts): The key methods, techniques, or applications. Be very selective — only the most distinctive aspect of this work. Prefer reusing existing concepts over creating new ones.${existingSection}

Relationships: Only include 1-2 genuinely meaningful connections. Every specific concept should have a "part of" relationship to its broad concept.

Return JSON:
{"concepts": [{"label": "human-computer interaction", "level": "broad"}, {"label": "eye tracking", "level": "specific"}], "relationships": [{"from": "eye tracking", "to": "human-computer interaction", "relation": "part of"}]}

Relationship types: "uses", "extends", "applied to", "enables", "contrasts with", "part of", "evaluates"

Normalize all labels to lowercase. Max 3 concepts total.

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
