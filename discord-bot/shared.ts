import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --- Supabase ---

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// --- LLM (DeepSeek) ---

let _llm: OpenAI | null = null;

function getLLM(): OpenAI {
  if (!_llm) {
    _llm = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      baseURL: "https://api.deepseek.com",
    });
  }
  return _llm;
}

export type Metadata = {
  title: string;
  authors: string;
  year: number | null;
  abstract: string;
  keywords: string[];
};

export async function extractUrlMetadata(
  pageText: string,
  url: string
): Promise<Metadata> {
  const truncated = pageText.slice(0, 6000);

  const response = await getLLM().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You extract structured metadata from web page content. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Extract the title, authors, publication year, a concise summary (as "abstract"), and 3-5 keywords from this web page content.

URL: ${url}

Return JSON in this exact format:
{"title": "...", "authors": "...", "year": 2024, "abstract": "...", "keywords": ["...", "..."]}

For "authors", list all author names comma-separated (e.g. "Smith, J., Lee, K."). If no authors found, use "".
For "year", use the publication year as a number. If unknown, use null.

Page content:
${truncated}`,
      },
    ],
    temperature: 0,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      title: parsed.title || "",
      authors: parsed.authors || "",
      year: typeof parsed.year === "number" ? parsed.year : null,
      abstract: parsed.abstract || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { title: "", authors: "", year: null, abstract: "", keywords: [] };
  }
}

export async function extractPaperMetadata(
  rawText: string
): Promise<Metadata> {
  const truncated = rawText.slice(0, 6000);

  const response = await getLLM().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You extract structured metadata from academic paper text. Return ONLY valid JSON, no markdown fences.",
      },
      {
        role: "user",
        content: `Extract the title, authors, publication year, abstract, and keywords from this paper text. If keywords aren't explicitly listed, infer 3-5 relevant ones from the content.

Return JSON in this exact format:
{"title": "...", "authors": "...", "year": 2024, "abstract": "...", "keywords": ["...", "..."]}

For "authors", list all author names comma-separated (e.g. "Smith, J., Lee, K."). If no authors found, use "".
For "year", use the publication year as a number. If unknown, use null.

Paper text:
${truncated}`,
      },
    ],
    temperature: 0,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      title: parsed.title || "",
      authors: parsed.authors || "",
      year: typeof parsed.year === "number" ? parsed.year : null,
      abstract: parsed.abstract || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { title: "", authors: "", year: null, abstract: "", keywords: [] };
  }
}

// --- Supabase Helpers ---

export async function getCurrentCycleId(): Promise<string | null> {
  const { data: cycle } = await getSupabase()
    .from("cycles")
    .select("id")
    .eq("status", "collecting")
    .order("cycle_number", { ascending: false })
    .limit(1)
    .single();

  return cycle?.id || null;
}

export async function findOrCreateProfile(
  discordUserId: string,
  discordDisplayName: string
): Promise<string> {
  const supabase = getSupabase();

  // First: try to find by discord_id (linked account)
  const { data: linked } = await supabase
    .from("profiles")
    .select("id")
    .eq("discord_id", discordUserId)
    .single();

  if (linked) return linked.id;

  // Fallback: try matching by name
  const { data: byName } = await supabase
    .from("profiles")
    .select("id")
    .eq("name", discordDisplayName)
    .single();

  if (byName) {
    // Auto-link this Discord account to the matched profile
    await supabase
      .from("profiles")
      .update({ discord_id: discordUserId })
      .eq("id", byName.id);
    return byName.id;
  }

  // Create a new profile for this Discord user
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ name: discordDisplayName, discord_id: discordUserId })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create profile: ${error.message}`);
  return created!.id;
}

export async function linkProfile(
  discordUserId: string,
  profileName: string
): Promise<{ success: boolean; profileId?: string; error?: string }> {
  const supabase = getSupabase();

  // Check if already linked
  const { data: alreadyLinked } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("discord_id", discordUserId)
    .single();

  if (alreadyLinked) {
    return {
      success: false,
      error: `You're already linked to profile "${alreadyLinked.name}". Contact an admin to change it.`,
    };
  }

  // Find profile by name
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, discord_id")
    .eq("name", profileName)
    .single();

  if (!profile) {
    return { success: false, error: `No profile found with name "${profileName}".` };
  }

  if (profile.discord_id) {
    return { success: false, error: `That profile is already linked to another Discord account.` };
  }

  // Link it
  await supabase
    .from("profiles")
    .update({ discord_id: discordUserId })
    .eq("id", profile.id);

  return { success: true, profileId: profile.id };
}

export async function listProfiles(): Promise<{ id: string; name: string }[]> {
  const { data } = await getSupabase()
    .from("profiles")
    .select("id, name")
    .order("name");

  return data || [];
}

export async function createSubmission(params: {
  profileId: string;
  contentType: "paper" | "link" | "note" | "idea";
  title: string | null;
  body: string;
  authors?: string | null;
  year?: number | null;
  filePath?: string | null;
  sourceUrl?: string | null;
}): Promise<{ id: string }> {
  const cycleId = await getCurrentCycleId();
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("submissions")
    .insert({
      profile_id: params.profileId,
      content_type: params.contentType,
      title: params.title,
      body: params.body,
      authors: params.authors || null,
      year: params.year || null,
      file_path: params.filePath || null,
      source_url: params.sourceUrl || null,
      cycle_id: cycleId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create submission: ${error.message}`);
  return data!;
}

/**
 * Check if this person already submitted this exact URL.
 * Different people submitting the same URL is allowed (shared interest).
 */
export async function checkDuplicateUrl(
  url: string,
  profileId: string
): Promise<{ title: string } | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("submissions")
    .select("title")
    .eq("source_url", url)
    .eq("profile_id", profileId)
    .limit(1)
    .single();

  if (!data) return null;
  return { title: data.title || url };
}

export async function getCycleStats(): Promise<{
  totalItems: number;
  contributorCount: number;
  cycleNumber: number;
}> {
  const supabase = getSupabase();

  const { data: cycle } = await supabase
    .from("cycles")
    .select("id, cycle_number")
    .eq("status", "collecting")
    .order("cycle_number", { ascending: false })
    .limit(1)
    .single();

  if (!cycle) return { totalItems: 0, contributorCount: 0, cycleNumber: 0 };

  const { count } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("cycle_id", cycle.id);

  const { data: contributors } = await supabase
    .from("submissions")
    .select("profile_id")
    .eq("cycle_id", cycle.id);

  const uniqueContributors = new Set(
    contributors?.map((c) => c.profile_id)
  ).size;

  return {
    totalItems: count || 0,
    contributorCount: uniqueContributors,
    cycleNumber: cycle.cycle_number,
  };
}

// --- Chat with Funnel ---

export async function chatWithFunnel(question: string, dmUserName?: string): Promise<string> {
  const supabase = getSupabase();

  // Fetch all submissions with profile names
  const { data: submissions } = await supabase
    .from("submissions")
    .select("title, body, content_type, authors, year, created_at, profiles(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!submissions || submissions.length === 0) {
    return "The funnel is empty — no submissions yet. Ask people to drop some papers and links!";
  }

  // Build context from submissions
  const context = submissions
    .map((s: any) => {
      const contributor = s.profiles?.name || "Unknown";
      const paperAuthors = s.authors ? `Paper authors: ${s.authors}` : "";
      const year = s.year ? `Year: ${s.year}` : "";
      const meta = [paperAuthors, year].filter(Boolean).join(" | ");
      return `[${s.content_type}] "${s.title}" — contributed to funnel by: ${contributor}\n${meta}\n${s.body?.slice(0, 500) || ""}`;
    })
    .join("\n\n---\n\n");

  const response = await getLLM().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: dmUserName
          ? `You are the knowledge funnel assistant, chatting privately with ${dmUserName}. The knowledge funnel is our group's shared knowledge base — everyone contributes papers, links, notes, and ideas, and you help navigate what's been collected and encourage new submissions.

RULES:
- Greet ${dmUserName} by name on first interaction. Be warm but brief.
- Be SHORT. Match the intensity of the question. A simple question gets 1-3 sentences.
- When answering questions, point to relevant submissions already in the funnel. Name the title and who contributed it (the "contributed to funnel by" name, NOT the paper authors).
- IMPORTANT: "contributed to funnel by" is the person who added it to our knowledge base. "Paper authors" are who wrote the original work. Always distinguish these — attribute submissions to the contributor, not the paper authors.
- Do NOT summarize papers unless explicitly asked. Just point to them.
- NEVER claim something is already in the database or is a duplicate. You don't have the ability to check for duplicates. Only the system can do that.
- Only link to the website if they explicitly ask for a full list or overview: "See all submissions at https://knowledge-funnel.vercel.app"
- When listing multiple items, use a compact format: "**Title** (contributed by Name)" on each line.
- Never be generic or filler-y. Every sentence should contain useful information.
- You can help them contribute: they can drop PDFs here, or use /submit-link and /submit-note to add to the funnel.

=== CURRENT KNOWLEDGE BASE ===
${context}`
          : `You are the knowledge funnel assistant. The knowledge funnel is our group's shared knowledge base — everyone contributes papers, links, notes, and ideas, and you help navigate what's been collected and encourage new submissions.

RULES:
- Be SHORT. Match the intensity of the question. A simple question gets 1-3 sentences.
- When answering questions, point to relevant submissions already in the funnel. Name the title and who contributed it (the "contributed to funnel by" name, NOT the paper authors).
- IMPORTANT: "contributed to funnel by" is the person who added it to our knowledge base. "Paper authors" are who wrote the original work. Always distinguish these — attribute submissions to the contributor, not the paper authors.
- Do NOT summarize papers unless explicitly asked. Just point to them.
- NEVER claim something is already in the database or is a duplicate. You don't have the ability to check for duplicates. Only the system can do that.
- Only link to the website if they explicitly ask for a full list or overview: "See all submissions at https://knowledge-funnel.vercel.app"
- When listing multiple items, use a compact format: "**Title** (contributed by Name)" on each line.
- Never be generic or filler-y. Every sentence should contain useful information.
- You can help people contribute: they can drop PDFs here, or use /submit-link and /submit-note to add to the funnel.

=== CURRENT KNOWLEDGE BASE ===
${context}`,
      },
      {
        role: "user",
        content: question,
      },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  return response.choices[0]?.message?.content || "I couldn't generate a response. Try again.";
}

// --- Concept Extraction (auto-runs after submission) ---

interface ExtractedConcept {
  label: string;
  level: "broad" | "specific";
}

interface ExtractedRelationship {
  from: string;
  to: string;
  relation: string;
}

async function llmExtractConcepts(
  title: string,
  body: string
): Promise<{ concepts: ExtractedConcept[]; relationships: ExtractedRelationship[] }> {
  const text = `${title || ""}\n\n${body || ""}`.trim().slice(0, 4000);

  const response = await getLLM().chat.completions.create({
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
          .filter((r: { from?: string; to?: string; relation?: string }) => r.from && r.to && r.relation)
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

/**
 * Extract concepts from a submission and link them in the database.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function extractAndLinkConcepts(
  submissionId: string,
  title: string,
  body: string
): Promise<void> {
  try {
    const supabase = getSupabase();
    const result = await llmExtractConcepts(title, body);
    if (result.concepts.length === 0) return;

    // Upsert concepts
    const conceptIds = new Map<string, string>();
    for (const concept of result.concepts) {
      // Try to find existing
      const { data: existing } = await supabase
        .from("concepts")
        .select("id, level")
        .eq("label", concept.label)
        .single();

      if (existing) {
        conceptIds.set(concept.label, existing.id);
        // Upgrade to broad if needed
        if (concept.level === "broad" && existing.level !== "broad") {
          await supabase
            .from("concepts")
            .update({ level: "broad" })
            .eq("id", existing.id);
        }
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("concepts")
          .insert({ label: concept.label, level: concept.level })
          .select("id")
          .single();
        if (insertErr) {
          // Race condition — re-fetch
          const { data: retry } = await supabase
            .from("concepts")
            .select("id")
            .eq("label", concept.label)
            .single();
          if (retry) conceptIds.set(concept.label, retry.id);
          continue;
        }
        if (inserted) conceptIds.set(concept.label, inserted.id);
      }
    }

    // Link submission → concepts
    const links = Array.from(conceptIds.values()).map((conceptId) => ({
      submission_id: submissionId,
      concept_id: conceptId,
    }));
    if (links.length > 0) {
      await supabase
        .from("submission_concepts")
        .upsert(links, { onConflict: "submission_id,concept_id" });
    }

    // Create edges only for LLM-specified relationships
    for (const rel of result.relationships) {
      const sourceId = conceptIds.get(rel.from);
      const targetId = conceptIds.get(rel.to);
      if (!sourceId || !targetId || sourceId === targetId) continue;

      const { data: existingEdge } = await supabase
        .from("concept_edges")
        .select("id, weight")
        .or(
          `and(source_id.eq.${sourceId},target_id.eq.${targetId}),and(source_id.eq.${targetId},target_id.eq.${sourceId})`
        )
        .single();

      if (existingEdge) {
        await supabase
          .from("concept_edges")
          .update({
            weight: (existingEdge.weight || 1) + 1,
            relation: rel.relation,
          })
          .eq("id", existingEdge.id);
      } else {
        await supabase.from("concept_edges").insert({
          source_id: sourceId,
          target_id: targetId,
          relation: rel.relation,
          weight: 1,
        });
      }
    }

    console.log(`Extracted ${result.concepts.length} concepts for submission ${submissionId.slice(0, 8)}`);
  } catch (err) {
    console.error("Concept extraction failed (non-blocking):", err);
  }
}

// --- URL Fetching ---

export async function fetchAndExtractUrl(
  url: string
): Promise<Metadata> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; KnowledgeFunnel/1.0; +https://knowledge-funnel.vercel.app)",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);

  const html = await res.text();
  const plainText = htmlToPlainText(html);

  if (plainText.length < 30) {
    // Fallback to title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      title: titleMatch ? titleMatch[1].trim().slice(0, 200) : url,
      authors: "",
      year: null,
      abstract: "",
      keywords: [],
    };
  }

  const metadata = await extractUrlMetadata(plainText, url);

  // Fallback title
  if (!metadata.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) metadata.title = titleMatch[1].trim().slice(0, 200);
  }

  return metadata;
}

function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
