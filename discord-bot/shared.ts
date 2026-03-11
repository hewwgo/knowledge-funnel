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

export async function extractUrlMetadata(
  pageText: string,
  url: string
): Promise<{ title: string; abstract: string; keywords: string[] }> {
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
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
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

export async function extractPaperMetadata(
  rawText: string
): Promise<{ title: string; abstract: string; keywords: string[] }> {
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
    const cleaned = content
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
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
  filePath?: string | null;
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
      file_path: params.filePath || null,
      cycle_id: cycleId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create submission: ${error.message}`);
  return data!;
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

// --- URL Fetching ---

export async function fetchAndExtractUrl(
  url: string
): Promise<{ title: string; abstract: string; keywords: string[] }> {
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
