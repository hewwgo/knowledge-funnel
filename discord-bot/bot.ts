import "dotenv/config";
import { Client, GatewayIntentBits, Events } from "discord.js";
import {
  handleSubmitLink,
  handleSubmitNote,
  handleFunnelStatus,
  handleMySubmissions,
  handlePdfAttachment,
} from "./handlers.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Bot online as ${c.user.tag}`);

  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (channelId) {
    console.log(`Listening for PDFs in channel ${channelId}`);
  } else {
    console.log("No DISCORD_CHANNEL_ID set — PDF uploads disabled");
  }
});

// --- Slash Commands ---

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Restrict slash commands to the configured channel
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (channelId && interaction.channelId !== channelId) {
    await interaction.reply({
      content: `This command only works in <#${channelId}>.`,
      flags: ["Ephemeral"],
    });
    return;
  }

  switch (interaction.commandName) {
    case "submit-link":
      await handleSubmitLink(interaction);
      break;
    case "submit-note":
      await handleSubmitNote(interaction);
      break;
    case "funnel-status":
      await handleFunnelStatus(interaction);
      break;
    case "my-submissions":
      await handleMySubmissions(interaction);
      break;
  }
});

// --- PDF Attachment Detection ---

const processedMessages = new Set<string>();

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);

  // Keep set from growing forever
  if (processedMessages.size > 1000) processedMessages.clear();

  const pdfAttachment = message.attachments.find(
    (a) =>
      a.name?.toLowerCase().endsWith(".pdf") ||
      a.contentType === "application/pdf"
  );

  if (pdfAttachment) {
    await handlePdfAttachment(message, pdfAttachment);
  }
});

// --- Start ---

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is required. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

client.login(token);
