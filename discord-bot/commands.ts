import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("submit-link")
    .setDescription("Submit a URL to the knowledge funnel")
    .addStringOption((opt) =>
      opt
        .setName("url")
        .setDescription("The URL to submit")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("comment")
        .setDescription("Optional comment or context about this link")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("submit-note")
    .setDescription("Submit a research note or idea to the funnel")
    .addStringOption((opt) =>
      opt
        .setName("text")
        .setDescription("Your note, idea, or observation")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("Is this a note or an idea?")
        .setRequired(false)
        .addChoices(
          { name: "Note", value: "note" },
          { name: "Idea", value: "idea" }
        )
    ),

  new SlashCommandBuilder()
    .setName("funnel-status")
    .setDescription("Show current funnel cycle status"),

  new SlashCommandBuilder()
    .setName("my-submissions")
    .setDescription("List your submissions in the current cycle"),
];
