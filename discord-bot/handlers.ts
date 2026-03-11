import {
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  Attachment,
} from "discord.js";
import {
  findOrCreateProfile,
  createSubmission,
  fetchAndExtractUrl,
  extractPaperMetadata,
  getCycleStats,
  getSupabase,
} from "./shared.js";

const EMBED_COLOR = 0x2A2535;

// --- Slash Command Handlers ---

export async function handleSubmitLink(
  interaction: ChatInputCommandInteraction
) {
  await interaction.deferReply();

  const url = interaction.options.getString("url", true);
  const comment = interaction.options.getString("comment");

  try {
    // Validate URL
    new URL(url);
  } catch {
    await interaction.editReply("That doesn't look like a valid URL.");
    return;
  }

  try {
    const profileId = await findOrCreateProfile(
      interaction.user.id,
      interaction.user.displayName || interaction.user.username
    );

    // Fetch and extract metadata
    const metadata = await fetchAndExtractUrl(url);

    // Build body (same format as web UI)
    const parts: string[] = [];
    if (metadata.abstract) parts.push(metadata.abstract);
    if (metadata.keywords.length > 0)
      parts.push(`Keywords: ${metadata.keywords.join(", ")}`);
    parts.push(`Source: ${url}`);
    if (comment) parts.push(`Comment: ${comment}`);

    const submission = await createSubmission({
      profileId,
      contentType: "link",
      title: metadata.title || url,
      body: parts.join("\n\n"),
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("Link submitted to the funnel")
      .setDescription(
        metadata.title ? `**${metadata.title}**\n${url}` : url
      )
      .setFooter({ text: `Submission ${submission.id.slice(0, 8)}` })
      .setTimestamp();

    if (metadata.abstract) {
      embed.addFields({
        name: "Summary",
        value: metadata.abstract.slice(0, 1024),
      });
    }
    if (metadata.keywords.length > 0) {
      embed.addFields({
        name: "Keywords",
        value: metadata.keywords.join(", "),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("submit-link error:", err);
    await interaction.editReply(
      "Something went wrong processing that link. Check the URL and try again."
    );
  }
}

export async function handleSubmitNote(
  interaction: ChatInputCommandInteraction
) {
  await interaction.deferReply();

  const text = interaction.options.getString("text", true);
  const type = (interaction.options.getString("type") || "note") as
    | "note"
    | "idea";

  try {
    const profileId = await findOrCreateProfile(
      interaction.user.id,
      interaction.user.displayName || interaction.user.username
    );

    // Use first line or first 100 chars as title
    const firstLine = text.split("\n")[0].slice(0, 100);

    const submission = await createSubmission({
      profileId,
      contentType: type,
      title: firstLine,
      body: text,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`${type === "idea" ? "Idea" : "Note"} submitted to the funnel`)
      .setDescription(text.slice(0, 2048))
      .setFooter({ text: `Submission ${submission.id.slice(0, 8)}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("submit-note error:", err);
    await interaction.editReply("Something went wrong saving that note.");
  }
}

export async function handleFunnelStatus(
  interaction: ChatInputCommandInteraction
) {
  await interaction.deferReply();

  try {
    const stats = await getCycleStats();

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("Knowledge Funnel Status")
      .addFields(
        {
          name: "Cycle",
          value: `#${stats.cycleNumber}`,
          inline: true,
        },
        {
          name: "Items",
          value: `${stats.totalItems}`,
          inline: true,
        },
        {
          name: "Contributors",
          value: `${stats.contributorCount}`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("funnel-status error:", err);
    await interaction.editReply("Could not fetch funnel status.");
  }
}

export async function handleMySubmissions(
  interaction: ChatInputCommandInteraction
) {
  await interaction.deferReply();

  try {
    const profileId = await findOrCreateProfile(
      interaction.user.id,
      interaction.user.displayName || interaction.user.username
    );

    const supabase = getSupabase();

    // Get current cycle
    const { data: cycle } = await supabase
      .from("cycles")
      .select("id")
      .eq("status", "collecting")
      .order("cycle_number", { ascending: false })
      .limit(1)
      .single();

    const query = supabase
      .from("submissions")
      .select("id, content_type, title, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (cycle) query.eq("cycle_id", cycle.id);

    const { data: submissions } = await query;

    if (!submissions || submissions.length === 0) {
      await interaction.editReply(
        "You haven't submitted anything this cycle yet. Use `/submit-link` or `/submit-note` to get started!"
      );
      return;
    }

    const lines = submissions.map((s) => {
      const icon =
        s.content_type === "paper"
          ? "📄"
          : s.content_type === "link"
            ? "🔗"
            : s.content_type === "idea"
              ? "💡"
              : "📝";
      const date = new Date(s.created_at).toLocaleDateString();
      return `${icon} **${s.title || "(untitled)"}** — ${date}`;
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("Your Submissions (Current Cycle)")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${submissions.length} item(s)` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("my-submissions error:", err);
    await interaction.editReply("Could not fetch your submissions.");
  }
}

// --- PDF Attachment Handler ---

export async function handlePdfAttachment(
  message: Message,
  attachment: Attachment
) {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (channelId && message.channelId !== channelId) return;

  await message.reply("Processing your PDF...");

  try {
    const profileId = await findOrCreateProfile(
      message.author.id,
      message.author.displayName || message.author.username
    );

    // Download the PDF
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // Upload to Supabase Storage
    const fileName = `${Date.now()}-${attachment.name}`;
    const supabase = getSupabase();

    const { error: uploadError } = await supabase.storage
      .from("funnel-uploads")
      .upload(fileName, buffer, {
        contentType: "application/pdf",
      });

    if (uploadError)
      throw new Error(`Storage upload failed: ${uploadError.message}`);

    // Extract text (dynamic import for unpdf since it's ESM)
    let rawText = "";
    try {
      const { extractText } = await import("unpdf");
      const uint8 = new Uint8Array(buffer);
      const { text } = await extractText(uint8);
      rawText = Array.isArray(text) ? text.join("\n") : text || "";
    } catch (err) {
      console.error("PDF text extraction failed:", err);
    }

    // LLM metadata extraction
    let title = "";
    let abstract = "";
    let keywords: string[] = [];

    if (rawText.length > 50) {
      const metadata = await extractPaperMetadata(rawText);
      title = metadata.title;
      abstract = metadata.abstract;
      keywords = metadata.keywords;
    }

    if (!title) {
      title = attachment.name.replace(/\.pdf$/i, "");
    }

    // Build body
    const parts: string[] = [];
    if (abstract) parts.push(abstract);
    if (keywords.length > 0) parts.push(`Keywords: ${keywords.join(", ")}`);
    parts.push(`File: ${fileName}`);

    const submission = await createSubmission({
      profileId,
      contentType: "paper",
      title,
      body: parts.join("\n\n"),
      filePath: fileName,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("Paper submitted to the funnel")
      .setDescription(`**${title}**`)
      .setFooter({ text: `Submission ${submission.id.slice(0, 8)}` })
      .setTimestamp();

    if (abstract) {
      embed.addFields({
        name: "Abstract",
        value: abstract.slice(0, 1024),
      });
    }
    if (keywords.length > 0) {
      embed.addFields({
        name: "Keywords",
        value: keywords.join(", "),
      });
    }

    await message.reply({ embeds: [embed] });
  } catch (err) {
    console.error("PDF handler error:", err);
    await message.reply(
      "Something went wrong processing that PDF. Please try again."
    );
  }
}
