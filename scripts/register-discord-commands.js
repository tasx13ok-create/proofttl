const applicationId = clean(process.env.DISCORD_APPLICATION_ID);
const token = clean(process.env.DISCORD_BOT_TOKEN);
const guildId = clean(process.env.DISCORD_GUILD_ID);

if (!applicationId || !token) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN before running this script.");
  process.exit(1);
}

const commands = [
  {
    name: "love",
    description: "Talk to L.O.V.E.",
    type: 1,
    options: [
      {
        name: "prompt",
        description: "What do you want to ask L.O.V.E.?",
        type: 3,
        required: true,
        max_length: 1200
      }
    ]
  },
  {
    name: "love-reset",
    description: "Clear your L.O.V.E. conversation context in this channel",
    type: 1
  },
  {
    name: "lease",
    description: "Inspect a ProofTTL Fact Lease",
    type: 1,
    options: [
      {
        name: "id",
        description: "Fact Lease ID (ftl_...)",
        type: 3,
        required: true,
        max_length: 80
      }
    ]
  },
  {
    name: "about",
    description: "About L.O.V.E. and ProofTTL",
    type: 1
  },
  {
    name: "Ask L.O.V.E.",
    type: 3
  }
];

const route = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(route, {
  method: "PUT",
  headers: {
    authorization: `Bot ${token}`,
    "content-type": "application/json",
    "user-agent": "ProofTTL-L.O.V.E. (https://proofttl-web.vercel.app, 1.0.0)"
  },
  body: JSON.stringify(commands)
});

const body = await response.text();
if (!response.ok) {
  console.error(`Discord command registration failed (${response.status}): ${body}`);
  process.exit(1);
}

const registered = JSON.parse(body);
console.log(`Registered ${registered.length} Discord commands ${guildId ? `for guild ${guildId}` : "globally"}:`);
for (const command of registered) console.log(`- ${command.name} (${command.id})`);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
