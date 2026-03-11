import {
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  Attachment,
  ChannelType,
} from "discord.js";
import {
  findOrCreateProfile,
  createSubmission,
  fetchAndExtractUrl,
  extractPaperMetadata,
  getCycleStats,
  getSupabase,
  chatWithFunnel,
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
    const displayName =
      interaction.member && "displayName" in interaction.member
        ? (interaction.member.displayName as string)
        : interaction.user.displayName || interaction.user.username;

    const profileId = await findOrCreateProfile(
      interaction.user.id,
      displayName
    );

    // Fetch and extract metadata (graceful fallback if site blocks us)
    let metadata = { title: "", authors: "", year: null as number | null, abstract: "", keywords: [] as string[] };
    let fetchWarning = "";
    try {
      metadata = await fetchAndExtractUrl(url);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("403")) {
        fetchWarning = "⚠️ This site blocked automated access (403 Forbidden). No content could be extracted. Try dropping the PDF directly, or use `/submit-note` to describe it in your own words.";
      } else if (msg.includes("404")) {
        fetchWarning = "⚠️ Page not found (404). Double-check the URL is correct and try again.";
      } else {
        fetchWarning = `⚠️ Could not fetch page content. Try dropping a PDF or using \`/submit-note\` instead. Error: ${msg.slice(0, 200)}`;
      }
      console.warn(`Could not fetch URL metadata (${url}):`, err);
    }

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
      authors: metadata.authors,
      year: metadata.year,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("Link submitted to the funnel")
      .setDescription(
        metadata.title ? `**${metadata.title}**\n${url}` : url
      )
      .setFooter({ text: `Submission ${submission.id.slice(0, 8)}` })
      .setTimestamp();

    embed.addFields({
      name: "Submitted by",
      value: displayName,
      inline: true,
    });
    if (metadata.authors) {
      embed.addFields({
        name: "Authors",
        value: metadata.authors.slice(0, 1024),
        inline: true,
      });
    }
    if (metadata.year) {
      embed.addFields({
        name: "Year",
        value: String(metadata.year),
        inline: true,
      });
    }
    if (comment) {
      embed.addFields({
        name: "Your Comment",
        value: comment.slice(0, 1024),
      });
    }
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
    if (fetchWarning) {
      embed.addFields({
        name: "Note",
        value: fetchWarning,
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
    const displayName =
      interaction.member && "displayName" in interaction.member
        ? (interaction.member.displayName as string)
        : interaction.user.displayName || interaction.user.username;

    const profileId = await findOrCreateProfile(
      interaction.user.id,
      displayName
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

    embed.addFields({
      name: "Submitted by",
      value: displayName,
      inline: true,
    });

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
    const displayName =
      interaction.member && "displayName" in interaction.member
        ? (interaction.member.displayName as string)
        : interaction.user.displayName || interaction.user.username;

    const profileId = await findOrCreateProfile(
      interaction.user.id,
      displayName
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

// --- Mention Chat Handler ---

export async function handleMention(message: Message, isDM = false) {
  // Strip the bot mention to get the question
  const question = isDM
    ? message.content.trim()
    : message.content.replace(/<@!?\d+>/g, "").trim();

  if (!question) {
    await message.reply("Ask me something about the funnel! e.g. *@Vacuum Bot what papers do we have about HCI?*");
    return;
  }

  try {
    if ('sendTyping' in message.channel) await message.channel.sendTyping();
    const dmUserName = isDM
      ? (message.member?.displayName || message.author.displayName || message.author.username)
      : undefined;
    const answer = await chatWithFunnel(question, dmUserName);

    // Discord has a 2000 char limit per message
    if (answer.length <= 2000) {
      await message.reply(answer);
    } else {
      // Split into chunks
      const chunks = answer.match(/[\s\S]{1,1990}/g) || [answer];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    }
  } catch (err) {
    console.error("mention-chat error:", err);
    await message.reply("Something went wrong processing your question. Try again.");
  }
}

// --- PDF Attachment Handler ---

export async function handlePdfAttachment(
  message: Message,
  attachment: Attachment
) {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  const isDM = message.channel.type === ChannelType.DM;
  if (!isDM && channelId && message.channelId !== channelId) return;

  const processingMsg = await message.reply("Processing your PDF...");

  try {
    const displayName =
      message.member?.displayName || message.author.displayName || message.author.username;

    const profileId = await findOrCreateProfile(
      message.author.id,
      displayName
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
    let authors = "";
    let year: number | null = null;
    let abstract = "";
    let keywords: string[] = [];

    if (rawText.length > 50) {
      const metadata = await extractPaperMetadata(rawText);
      title = metadata.title;
      authors = metadata.authors;
      year = metadata.year;
      abstract = metadata.abstract;
      keywords = metadata.keywords;
    }

    if (!title) {
      title = attachment.name.replace(/\.pdf$/i, "");
    }

    // Build body
    const parts: string[] = [];
    const userComment = message.content?.trim();
    if (userComment) parts.push(`Comment: ${userComment}`);
    if (abstract) parts.push(abstract);
    if (keywords.length > 0) parts.push(`Keywords: ${keywords.join(", ")}`);
    parts.push(`File: ${fileName}`);

    const submission = await createSubmission({
      profileId,
      contentType: "paper",
      title,
      body: parts.join("\n\n"),
      authors,
      year,
      filePath: fileName,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("Paper submitted to the funnel")
      .setDescription(`**${title}**`)
      .setFooter({ text: `Submission ${submission.id.slice(0, 8)}` })
      .setTimestamp();

    embed.addFields({
      name: "Submitted by",
      value: displayName,
      inline: true,
    });
    if (authors) {
      embed.addFields({
        name: "Authors",
        value: authors.slice(0, 1024),
        inline: true,
      });
    }
    if (year) {
      embed.addFields({
        name: "Year",
        value: String(year),
        inline: true,
      });
    }
    if (userComment) {
      embed.addFields({
        name: "Your Comment",
        value: userComment.slice(0, 1024),
      });
    }
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

    await processingMsg.delete().catch(() => {});
    await message.reply({ embeds: [embed] });
  } catch (err) {
    console.error("PDF handler error:", err);
    await processingMsg.delete().catch(() => {});
    await message.reply(
      "Something went wrong processing that PDF. Please try again."
    );
  }
}
