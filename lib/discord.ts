export async function sendDiscordNotification({
  name,
  contentType,
  totalCount,
  contributorCount,
}: {
  name: string;
  contentType: string;
  totalCount: number;
  contributorCount: number;
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL not set, skipping notification");
    return;
  }

  const payload = {
    embeds: [
      {
        title: "New item in the funnel",
        description: `**${name}** dropped a ${contentType} into the knowledge funnel.`,
        color: 2763429,
        footer: {
          text: `Cycle 1 \u00b7 ${totalCount} items from ${contributorCount} contributors`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Discord webhook failed:", err);
  }
}
