#!/usr/bin/env node

/**
 * oh-my-humanizer Discord Listener
 *
 * Listens for messages in a designated Discord channel and responds
 * using claude -p with the interactive prompt. Natural language chat,
 * no command prefixes needed.
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { exec } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, '..');

// --- Configuration ---
const CHANNEL_ID = process.env.DISCORD_CHANNEL || '1484400552262762496';
const ALLOWED_USERS = (process.env.DISCORD_ALLOWED_USERS || '266436073557590016').split(',');
const LOCK_FILE = '/tmp/oh-my-humanizer-bot.lock';
const MAX_MESSAGE_LENGTH = 500;
const MAX_QUEUE_SIZE = 3;
const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DANGEROUS_CHARS = /[$`|;&]|&&|\|\|/g;

// --- Resolve Discord bot token ---
function resolveToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;

  // Fallback: read from clawhip config
  const configPath = resolve(process.env.HOME, '.clawhip/config.toml');
  if (existsSync(configPath)) {
    const config = readFileSync(configPath, 'utf-8');
    const match = config.match(/token\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }

  console.error('No Discord bot token found. Set DISCORD_BOT_TOKEN or configure clawhip.');
  process.exit(1);
}

const BOT_TOKEN = resolveToken();

// --- State ---
let processing = false;
const queue = [];
let shuttingDown = false;

// --- Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message],
});

// --- Sanitize user input ---
function sanitize(text) {
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH);
  }
  return text.replace(DANGEROUS_CHARS, '');
}

// --- Split long responses for Discord's 2000 char limit ---
function splitMessage(text, limit = 1900) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt === -1 || splitAt < limit / 2) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// --- Run claude -p with the interactive prompt ---
async function runClaude(userMessage) {
  const promptPath = resolve(REPO_DIR, 'scripts/interactive-prompt.md');
  const promptTemplate = readFileSync(promptPath, 'utf-8');
  const date = new Date().toISOString().split('T')[0];

  const assembledPrompt = `${promptTemplate}

## User Message
Date: ${date}
User says: "${sanitize(userMessage)}"

Respond concisely in Korean. Do NOT use any tools that require user interaction.`;

  return new Promise((resolve, reject) => {
    const cmd = `flock -n ${LOCK_FILE} timeout 15m claude -p --dangerously-skip-permissions --allowedTools "Read,Write,Edit,Glob,Grep,Bash" --model sonnet`;

    const child = exec(cmd, {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
      },
      maxBuffer: 1024 * 1024,
      timeout: 15 * 60 * 1000,
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error('timeout'));
        } else if (stdout === '' && stderr === '') {
          reject(new Error('lock_held'));
        } else {
          reject(new Error(`exit_${error.code}`));
        }
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(assembledPrompt);
    child.stdin.end();
  });
}

// --- Process message queue ---
async function processQueue(channel) {
  if (processing || queue.length === 0 || shuttingDown) return;

  processing = true;
  const { message, userMessage } = queue.shift();

  try {
    await channel.sendTyping();
    const response = await runClaude(userMessage, channel);

    const chunks = splitMessage(response);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (err) {
    let errorMsg;
    switch (err.message) {
      case 'timeout':
        errorMsg = '⏰ 15분 타임아웃 — 작업이 너무 오래 걸렸어요. 다시 시도하거나 범위를 좁혀주세요.';
        break;
      case 'lock_held':
        errorMsg = '🔒 다른 작업이 실행 중이에요 (cron 봇 또는 이전 요청). 잠시 후 다시 시도해주세요.';
        break;
      default:
        errorMsg = `❌ 실행 실패 — ${err.message}`;
    }
    await message.reply(errorMsg);
  } finally {
    processing = false;
    // Process next in queue
    if (queue.length > 0 && !shuttingDown) {
      processQueue(channel);
    }
  }
}

// --- Event handlers ---
client.once('clientReady', () => {
  console.log(`[listener] Connected as ${client.user.tag}`);
  console.log(`[listener] Watching channel: ${CHANNEL_ID}`);
  console.log(`[listener] Allowed users: ${ALLOWED_USERS.join(', ')}`);

  // Notify Discord
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    channel.send('🟢 oh-my-humanizer 봇 온라인 — 채팅으로 말 걸어주세요!');
  }

  // Heartbeat every 6 hours
  setInterval(() => {
    if (!processing && queue.length === 0) {
      const ch = client.channels.cache.get(CHANNEL_ID);
      if (ch) ch.send('💚 oh-my-humanizer 봇 정상 대기 중');
    }
  }, HEARTBEAT_INTERVAL_MS);
});

client.on('messageCreate', async (message) => {
  // Ignore bot's own messages
  if (message.author.bot) return;

  // Channel filter
  if (message.channel.id !== CHANNEL_ID) return;

  // User allowlist
  if (!ALLOWED_USERS.includes(message.author.id)) return;

  // Ignore empty messages
  const userMessage = message.content.trim();
  if (!userMessage) return;

  // Queue management
  if (queue.length >= MAX_QUEUE_SIZE) {
    await message.reply('⚠️ 대기열이 가득 찼어요 (최대 3개). 잠시 후 다시 시도해주세요.');
    return;
  }

  queue.push({ message, userMessage });
  console.log(`[listener] Queued: "${userMessage.slice(0, 50)}..." (queue: ${queue.length})`);

  if (queue.length > 1) {
    await message.reply(`📋 대기열 ${queue.length - 1}번째 — 이전 작업 완료 후 처리할게요.`);
  }

  processQueue(message.channel);
});

// --- Graceful shutdown ---
async function shutdown(signal) {
  console.log(`[listener] Received ${signal}, shutting down...`);
  shuttingDown = true;

  const channel = client.channels.cache.get(CHANNEL_ID);

  // Notify queued requests
  for (const { message } of queue) {
    try {
      await message.reply('🔴 봇이 종료됩니다. 이 요청은 취소돼요.');
    } catch (_) { /* channel may be gone */ }
  }
  queue.length = 0;

  // Wait for in-flight work (max 2 min)
  if (processing) {
    if (channel) await channel.send('🟡 진행 중인 작업 완료 대기 중...');
    const start = Date.now();
    while (processing && Date.now() - start < 120_000) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (channel) await channel.send('🔴 oh-my-humanizer 봇 오프라인');

  client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Start ---
console.log('[listener] Starting oh-my-humanizer Discord listener...');
client.login(BOT_TOKEN);
