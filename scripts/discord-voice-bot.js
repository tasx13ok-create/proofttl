import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} from '@discordjs/voice';
import prism from 'prism-media';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';

const token = clean(process.env.DISCORD_BOT_TOKEN);
const preferredGuildId = clean(process.env.DISCORD_GUILD_ID || process.env.DISCORD_VOICE_GUILD_ID);
const apiBase = clean(process.env.PROOFTTL_API_URL) || 'https://proofttl.tasx13ok.workers.dev';
const silenceMs = positiveInt(process.env.DISCORD_VOICE_SILENCE_MS, 900);
const maxUtteranceMs = positiveInt(process.env.DISCORD_VOICE_MAX_UTTERANCE_MS, 14000);

if (!token) {
  console.error('Set DISCORD_BOT_TOKEN before starting Discord voice.');
  process.exit(1);
}
if (!ffmpegPath) {
  console.error('ffmpeg-static did not provide an ffmpeg binary.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const guildStates = new Map();

client.once('ready', async () => {
  console.log(`L.O.V.E. voice online as ${client.user?.tag || client.user?.id}`);
  for (const guild of client.guilds.cache.values()) {
    if (preferredGuildId && guild.id !== preferredGuildId) continue;
    await syncGuildVoice(guild).catch(logVoiceError);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  if (preferredGuildId && guild.id !== preferredGuildId) return;
  await syncGuildVoice(guild).catch(logVoiceError);
});

client.on('error', (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

await client.login(token);

async function syncGuildVoice(guild) {
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
    .filter((channel) => channel.members.some((member) => !member.user.bot));

  const current = guildStates.get(guild.id);
  if (!channels.length) {
    if (current) {
      current.connection.destroy();
      guildStates.delete(guild.id);
      console.log(`L.O.V.E. left voice in ${guild.name}; no humans remain.`);
    }
    return;
  }

  const target = channels[0];
  if (current?.channelId === target.id && current.connection.state.status !== VoiceConnectionStatus.Destroyed) return;

  if (current) {
    current.connection.destroy();
    guildStates.delete(guild.id);
  }

  const connection = joinVoiceChannel({
    channelId: target.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  const state = {
    guildId: guild.id,
    channelId: target.id,
    connection,
    player,
    speaking: false,
    busyUsers: new Set()
  };
  guildStates.set(guild.id, state);

  connection.receiver.speaking.on('start', (userId) => {
    if (state.speaking || state.busyUsers.has(userId)) return;
    const member = guild.members.cache.get(userId);
    if (!member || member.user.bot || member.voice.channelId !== target.id) return;
    state.busyUsers.add(userId);
    void captureUtterance(state, member).finally(() => state.busyUsers.delete(userId));
  });

  player.on(AudioPlayerStatus.Playing, () => { state.speaking = true; });
  player.on(AudioPlayerStatus.Idle, () => { state.speaking = false; });
  player.on('error', (error) => {
    state.speaking = false;
    console.error('Discord audio player error:', error.message);
  });

  console.log(`L.O.V.E. joined ${guild.name} / ${target.name}.`);
}

async function captureUtterance(state, member) {
  const opus = state.connection.receiver.subscribe(member.id, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: silenceMs }
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
  const pcmChunks = [];
  let total = 0;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    opus.destroy();
  }, maxUtteranceMs);

  try {
    opus.pipe(decoder);
    for await (const chunk of decoder) {
      const bytes = Buffer.from(chunk);
      pcmChunks.push(bytes);
      total += bytes.length;
      if (total > 48_000 * 2 * 2 * (maxUtteranceMs / 1000)) break;
    }
  } catch (error) {
    if (!timedOut) console.warn('Voice capture ended:', error?.message || error);
  } finally {
    clearTimeout(timeout);
    try { opus.destroy(); } catch {}
    try { decoder.destroy(); } catch {}
  }

  if (total < 48_000 * 2 * 2 * 0.25) return;
  const pcm = Buffer.concat(pcmChunks, total);
  const wav = pcmToWav(pcm, 48000, 2, 16);

  let payload;
  try {
    const response = await fetch(`${apiBase}/assistant/voice`, {
      method: 'POST',
      headers: {
        'content-type': 'audio/wav',
        'x-proofttl-client': 'discord-voice'
      },
      body: wav
    });
    payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn(`L.O.V.E. voice API ${response.status}:`, payload?.message || payload?.error || 'request failed');
      return;
    }
  } catch (error) {
    console.warn('L.O.V.E. voice API request failed:', error?.message || error);
    return;
  }

  const transcript = clean(payload?.transcript);
  const reply = clean(payload?.response);
  if (transcript) console.log(`${member.user.username}: ${transcript}`);
  if (reply) console.log(`L.O.V.E.: ${reply}`);

  const speech = payload?.speech;
  if (!speech?.available || !speech?.audio_base64) return;
  await playMp3Base64(state, speech.audio_base64);
}

async function playMp3Base64(state, base64) {
  const mp3 = Buffer.from(base64, 'base64');
  if (!mp3.length) return;

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ffmpeg.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) console.warn('ffmpeg:', text);
  });
  ffmpeg.on('error', (error) => console.warn('ffmpeg process error:', error.message));
  ffmpeg.stdin.end(mp3);

  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
  state.player.play(resource);
  await entersPlayerIdle(state.player, 30_000);
  if (!ffmpeg.killed) ffmpeg.kill();
}

function entersPlayerIdle(player, timeoutMs) {
  if (player.state.status === AudioPlayerStatus.Idle) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      player.off(AudioPlayerStatus.Idle, done);
      resolve();
    }
    player.once(AudioPlayerStatus.Idle, done);
  });
}

function pcmToWav(pcm, sampleRate, channels, bitsPerSample) {
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function logVoiceError(error) {
  console.error('Discord voice sync failed:', error?.message || error);
}
