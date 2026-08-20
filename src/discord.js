import { runAssistantResponse, assistantResponseProviderAvailable } from "./assistant-model-router.js";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_PROMPT_CHARS = 1200;
const MAX_REPLY_CHARS = 1900;
const HISTORY_TTL_SECONDS = 60 * 60 * 24;
const MAX_HISTORY = 6;
const LEASE_ID_PATTERN = /\bftl_[a-f0-9]{16,64}\b/i;

export async function handleDiscordInteractions(request, env, ctx) {
  if (request.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  if (!env.DISCORD_PUBLIC_KEY) return new Response("discord_not_configured", { status: 503 });

  const signature = request.headers.get("x-signature-ed25519") || "";
  const timestamp = request.headers.get("x-signature-timestamp") || "";
  const rawBody = await request.text();
  const valid = await verifyDiscordRequest(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  if (!valid) return new Response("invalid request signature", { status: 401 });

  let interaction;
  try { interaction = JSON.parse(rawBody); }
  catch { return new Response("invalid_json", { status: 400 }); }

  if (interaction.type === 1) return Response.json({ type: 1 });
  if (interaction.type !== 2) return Response.json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });

  const commandName = interaction?.data?.name;
  if (commandName === "about") {
    return Response.json({
      type: 4,
      data: {
        content: "**L.O.V.E. by ProofTTL**\nGeneral-purpose AI inside Discord with ProofTTL Fact Lease grounding when you reference a `ftl_...` lease ID. Use `/love`, `/lease`, or right-click a message → Apps → Ask L.O.V.E.",
        flags: 64
      }
    });
  }

  if (commandName === "love-reset") {
    await clearHistory(interaction, env);
    return Response.json({ type: 4, data: { content: "L.O.V.E. conversation context cleared for this channel.", flags: 64 } });
  }

  if (commandName === "lease") {
    const leaseId = stringOption(interaction, "id").toLowerCase();
    const content = await renderLease(leaseId, env);
    return Response.json({ type: 4, data: { content, flags: 64 } });
  }

  if (commandName !== "love" && commandName !== "Ask L.O.V.E.") {
    return Response.json({ type: 4, data: { content: "Unknown command.", flags: 64 } });
  }

  const prompt = commandName === "Ask L.O.V.E."
    ? selectedMessageContent(interaction)
    : stringOption(interaction, "prompt");

  if (!prompt) return Response.json({ type: 4, data: { content: "Give L.O.V.E. something to respond to.", flags: 64 } });
  if (prompt.length > MAX_PROMPT_CHARS) return Response.json({ type: 4, data: { content: `Keep prompts under ${MAX_PROMPT_CHARS} characters.`, flags: 64 } });

  const userId = discordUserId(interaction);
  if (!userId) return Response.json({ type: 4, data: { content: "Could not resolve your Discord user.", flags: 64 } });

  const limited = await rateLimited(userId, env);
  if (limited) return Response.json({ type: 4, data: { content: "You're sending requests too quickly. Try again in a moment.", flags: 64 } });

  const quota = await consumeDiscordDailyQuota(userId, env);
  if (!quota.allowed) return Response.json({ type: 4, data: { content: `You've reached today's Discord L.O.V.E. limit (${quota.limit}).`, flags: 64 } });

  if (!assistantResponseProviderAvailable(env)) {
    return Response.json({ type: 4, data: { content: "L.O.V.E. is temporarily unavailable.", flags: 64 } });
  }

  ctx.waitUntil(finishLoveInteraction(interaction, prompt, env));
  return Response.json({ type: 5, data: { flags: 0 } });
}

async function finishLoveInteraction(interaction, prompt, env) {
  try {
    const history = await loadHistory(interaction, env);
    const lease = await loadReferencedLease(prompt, env);
    const messages = [
      {
        role: "system",
        content: [
          "You are L.O.V.E., the general-purpose AI intelligence layer for ProofTTL, speaking inside Discord.",
          "Answer naturally and directly. Do not act like a corporate support bot unless the user asks about ProofTTL.",
          "Keep Discord replies compact and readable. Markdown is allowed. Never use mass mentions such as @everyone or @here.",
          "Do not claim you performed external actions unless an authoritative connected capability actually confirms it.",
          "Do not invent live/private data, citations, files, account state, balances, messages, or deployments.",
          "When authoritative Fact Lease JSON is supplied, it is the source of truth for that lease."
        ].join(" ")
      },
      ...(lease ? [{ role: "system", content: lease.found
        ? `Authoritative ProofTTL Fact Lease context: ${JSON.stringify(lease.data)}`
        : `The user referenced Fact Lease ${lease.id}, but it was not found. Do not invent its contents.` }]
        : []),
      ...history,
      { role: "user", content: prompt }
    ];

    const completion = await runAssistantResponse(env, { messages, max_tokens: 420, temperature: lease?.found ? 0.25 : 0.45 });
    const reply = sanitizeDiscordReply(extractCompletionText(completion)) || "I couldn't produce a usable reply. Try that again.";
    await saveHistory(interaction, prompt, reply, env);
    await editOriginal(interaction, reply);
  } catch (error) {
    console.warn(JSON.stringify({ event: "discord_love_failed", error: error?.name || "Error" }));
    await editOriginal(interaction, "L.O.V.E. hit a temporary error. Try that again in a moment.");
  }
}

async function renderLease(id, env) {
  if (!LEASE_ID_PATTERN.test(id)) return "Enter a valid ProofTTL Fact Lease ID (`ftl_...`).";
  if (!env.LEASES) return "Fact Lease storage is unavailable.";
  const raw = await env.LEASES.get(`lease:${id}`);
  if (!raw) return `Fact Lease \`${id}\` was not found.`;
  const lease = typeof raw === "string" ? JSON.parse(raw) : raw;
  const status = lease.current_status || lease.revocation?.current_status || lease.last_check?.status || lease.status || "UNKNOWN";
  const state = lease.lease_state || "UNKNOWN";
  const claim = String(lease.claim || "No claim").slice(0, 700);
  const expires = lease.expires_at ? `<t:${Math.floor(Date.parse(lease.expires_at) / 1000)}:R>` : "unknown";
  return `**ProofTTL Fact Lease**\n**ID:** \`${id}\`\n**State:** ${state}\n**Current status:** ${status}\n**Claim:** ${claim}\n**Expires:** ${expires}\nhttps://proofttl-web.vercel.app/verify-lease/?id=${encodeURIComponent(id)}`;
}

async function verifyDiscordRequest(body, signatureHex, timestamp, publicKeyHex) {
  try {
    if (!/^[0-9a-f]{128}$/i.test(signatureHex) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    const message = new TextEncoder().encode(timestamp + body);
    return crypto.subtle.verify("Ed25519", key, hexToBytes(signatureHex), message);
  } catch { return false; }
}

async function editOriginal(interaction, content) {
  const applicationId = interaction.application_id;
  const token = interaction.token;
  const response = await fetch(`${DISCORD_API}/webhooks/${applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: sanitizeDiscordReply(content), allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`discord_edit_failed_${response.status}`);
}

function stringOption(interaction, name) {
  const option = interaction?.data?.options?.find((item) => item?.name === name);
  return typeof option?.value === "string" ? option.value.trim() : "";
}

function selectedMessageContent(interaction) {
  const targetId = interaction?.data?.target_id;
  const message = interaction?.data?.resolved?.messages?.[targetId];
  if (!message) return "";
  return String(message.content || "").trim();
}

function discordUserId(interaction) {
  return interaction?.member?.user?.id || interaction?.user?.id || null;
}

function historyKey(interaction) {
  const user = discordUserId(interaction) || "unknown";
  const scope = interaction.channel_id || interaction.guild_id || "dm";
  return `discord:history:${scope}:${user}`;
}

async function loadHistory(interaction, env) {
  if (!env.LEASES) return [];
  try {
    const raw = await env.LEASES.get(historyKey(interaction));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
  } catch { return []; }
}

async function saveHistory(interaction, prompt, reply, env) {
  if (!env.LEASES) return;
  const history = await loadHistory(interaction, env);
  history.push({ role: "user", content: String(prompt).slice(0, 700) });
  history.push({ role: "assistant", content: String(reply).slice(0, 1200) });
  await env.LEASES.put(historyKey(interaction), JSON.stringify(history.slice(-MAX_HISTORY)), { expirationTtl: HISTORY_TTL_SECONDS });
}

async function clearHistory(interaction, env) {
  if (env.LEASES) await env.LEASES.delete(historyKey(interaction));
}

async function loadReferencedLease(prompt, env) {
  const match = String(prompt).match(LEASE_ID_PATTERN);
  if (!match) return null;
  const id = match[0].toLowerCase();
  if (!env.LEASES) return { id, found: false, data: null };
  const raw = await env.LEASES.get(`lease:${id}`);
  if (!raw) return { id, found: false, data: null };
  const lease = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    id,
    found: true,
    data: {
      lease_id: lease.lease_id,
      claim: lease.claim,
      issued_status: lease.issued_status || lease.status,
      current_status: lease.current_status || lease.revocation?.current_status || lease.last_check?.status || lease.status,
      lease_state: lease.lease_state,
      source_url: lease.source_url,
      issued_at: lease.issued_at,
      expires_at: lease.expires_at,
      last_checked_at: lease.last_checked_at,
      evidence: lease.evidence,
      reason: lease.reason,
      revocation: lease.revocation || null
    }
  };
}

async function rateLimited(userId, env) {
  if (!env.ASSISTANT_RATE_LIMITER?.limit) return false;
  const result = await env.ASSISTANT_RATE_LIMITER.limit({ key: `discord:${userId}` });
  return !result.success;
}

async function consumeDiscordDailyQuota(userId, env) {
  const limit = positiveInt(env.PROOFTTL_DISCORD_DAILY_MESSAGES, 40);
  if (!env.LEASES) return { allowed: true, limit, used: null };
  const day = new Date().toISOString().slice(0, 10);
  const key = `discord:quota:${day}:${userId}`;
  const used = Number(await env.LEASES.get(key) || 0);
  if (used >= limit) return { allowed: false, limit, used };
  await env.LEASES.put(key, String(used + 1), { expirationTtl: 172800 });
  return { allowed: true, limit, used: used + 1 };
}

function extractCompletionText(value) {
  if (typeof value === "string") return value;
  const candidates = [value?.response, value?.result?.response, value?.choices?.[0]?.message?.content, value?.result?.choices?.[0]?.message?.content];
  return candidates.find((item) => typeof item === "string") || "";
}

function sanitizeDiscordReply(value) {
  let text = String(value || "").trim();
  text = text.replace(/@everyone/gi, "@ everyone").replace(/@here/gi, "@ here");
  if (text.length > MAX_REPLY_CHARS) text = `${text.slice(0, MAX_REPLY_CHARS - 1)}…`;
  return text;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const DISCORD_INTERACTIONS_PATH = "/discord/interactions";
