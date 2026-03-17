import OpenAI from "openai";

// DeepSeek client for tags and labels (uses existing key)
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

// Voyage AI (Anthropic's embedding service) — free tier: 200M tokens/month
// Sign up at dash.voyageai.com, grab an API key
const embeddingClient = new OpenAI({
  apiKey: process.env.VOYAGE_API_KEY || "",
  baseURL: "https://api.voyageai.com/v1",
});

const EMBEDDING_MODEL = "voyage-3-lite";

// Generate embeddings for an array of texts
// Batches in chunks of 100
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const BATCH_SIZE = 100;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await embeddingClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const item of response.data) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

// Generate tags for a submission's text content
export async function generateTags(
  text: string
): Promise<{ tag: string; confidence: number }[]> {
  const truncated = text.slice(0, 4000);

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You generate short topic tags for academic text fragments. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Given this text from an academic/research context, generate 2-4 short topic tags (2-3 words each). Return as JSON array of objects with "tag" and "confidence" (0-1) fields.

Text:
${truncated}`,
      },
    ],
    temperature: 0,
    max_tokens: 300,
  });

  const content = response.choices[0]?.message?.content || "";
  try {
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((t: { tag: string; confidence: number }) => ({
        tag: String(t.tag || ""),
        confidence: Number(t.confidence) || 0.5,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// Generate a short cluster label from representative texts
export async function generateClusterLabel(
  texts: string[]
): Promise<string> {
  const combined = texts.map((t, i) => `[${i + 1}] ${t.slice(0, 500)}`).join("\n\n");

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You generate concise thematic labels for clusters of research text.",
      },
      {
        role: "user",
        content: `These text fragments form a thematic cluster in a research group's knowledge base. Generate a 2-4 word label that captures the shared theme. Return only the label, nothing else.

${combined}`,
      },
    ],
    temperature: 0,
    max_tokens: 30,
  });

  return response.choices[0]?.message?.content?.trim() || "Unlabeled Cluster";
}
