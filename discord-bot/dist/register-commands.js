import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
const token = process.env.DISCORD_BOT_TOKEN;
async function register() {
    const rest = new REST({ version: "10" }).setToken(token);
    // Get the bot's application ID
    const app = (await rest.get(Routes.currentApplication()));
    console.log(`Registering ${commands.length} slash commands...`);
    await rest.put(Routes.applicationCommands(app.id), {
        body: commands.map((c) => c.toJSON()),
    });
    console.log("Slash commands registered globally. May take up to 1 hour to propagate.");
    console.log("For instant testing, register to a specific guild instead.");
}
register().catch(console.error);
