import "dotenv/config";
import { Client, GatewayIntentBits, Events, ChannelType, Partials } from "discord.js";
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { resolve } from "path";
import { handleSubmitLink, handleSubmitNote, handleFunnelStatus, handleMySubmissions, handlePdfAttachment, handleMention, } from "./handlers.js";
// --- Single-instance guard (PID file) ---
const PID_FILE = resolve(import.meta.dirname ?? ".", "bot.pid");
function acquireLock() {
    if (existsSync(PID_FILE)) {
        const oldPid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        // Check if that process is still alive
        try {
            process.kill(oldPid, 0); // signal 0 = just check existence
            console.error(`Another bot instance is already running (PID ${oldPid}). Kill it first or delete ${PID_FILE}.`);
            process.exit(1);
        }
        catch {
            // Process is dead — stale PID file, safe to overwrite
            console.log(`Removing stale PID file (old PID ${oldPid}).`);
        }
    }
    writeFileSync(PID_FILE, String(process.pid), "utf-8");
}
function releaseLock() {
    try {
        if (existsSync(PID_FILE))
            unlinkSync(PID_FILE);
    }
    catch { }
}
acquireLock();
// --- Discord Client ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});
// Prevent unhandled errors from crashing the bot
client.on("error", (err) => console.error("Client error:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
client.once(Events.ClientReady, (c) => {
    console.log(`Bot online as ${c.user.tag} (PID ${process.pid})`);
    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (channelId) {
        console.log(`Listening for PDFs in channel ${channelId}`);
    }
    else {
        console.log("No DISCORD_CHANNEL_ID set — PDF uploads disabled");
    }
});
// --- Slash Commands ---
const processedInteractions = new Set();
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    // Deduplicate interactions
    if (processedInteractions.has(interaction.id))
        return;
    processedInteractions.add(interaction.id);
    if (processedInteractions.size > 500)
        processedInteractions.clear();
    // Allow slash commands in DMs and the configured channel
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const isDM = !interaction.guildId;
    if (!isDM && channelId && interaction.channelId !== channelId) {
        try {
            await interaction.reply({
                content: `This command only works in <#${channelId}> or in DMs with me.`,
                flags: ["Ephemeral"],
            });
        }
        catch { }
        return;
    }
    try {
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
    }
    catch (err) {
        console.error(`Command ${interaction.commandName} error:`, err);
    }
});
// --- PDF Attachment Detection ---
const processedMessages = new Set();
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot)
        return;
    if (processedMessages.has(message.id))
        return;
    processedMessages.add(message.id);
    // Keep set from growing forever
    if (processedMessages.size > 1000)
        processedMessages.clear();
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const isDM = message.channel.type === ChannelType.DM;
    const isTargetChannel = channelId && message.channelId === channelId;
    // --- DM handling: submissions + chat ---
    if (isDM) {
        const pdfAttachment = message.attachments.find((a) => a.name?.toLowerCase().endsWith(".pdf") ||
            a.contentType === "application/pdf");
        if (pdfAttachment) {
            await handlePdfAttachment(message, pdfAttachment);
        }
        else if (message.content.trim()) {
            // In DMs, treat plain text as a chat question
            await handleMention(message, true);
        }
        return;
    }
    // --- Channel handling ---
    if (!isTargetChannel)
        return;
    // Check if bot was mentioned (chat mode)
    if (client.user && message.mentions.has(client.user)) {
        await handleMention(message);
        return;
    }
    // PDF detection
    const pdfAttachment = message.attachments.find((a) => a.name?.toLowerCase().endsWith(".pdf") ||
        a.contentType === "application/pdf");
    if (pdfAttachment) {
        await handlePdfAttachment(message, pdfAttachment);
    }
});
// --- Graceful Shutdown ---
async function shutdown(signal) {
    console.log(`\n${signal} received — shutting down...`);
    client.destroy();
    releaseLock();
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", releaseLock);
// --- Start ---
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error("DISCORD_BOT_TOKEN is required. Copy .env.example to .env and fill it in.");
    process.exit(1);
}
client.login(token);
