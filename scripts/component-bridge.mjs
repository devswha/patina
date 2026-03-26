#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, '..');

function loadLocalEnv() {
  const envPath = process.env.PATINA_ENV_FILE || resolve(REPO_DIR, '.env');
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadLocalEnv();

const RUNTIME_CLI = process.env.PATINA_RUNTIME_CLI || '';
const STATE_FILE = process.env.COMPONENT_BRIDGE_STATE_FILE || resolve(REPO_DIR, '.omx/state/component-bridge.json');
const CHANNEL_ID = process.env.COMPONENT_BRIDGE_CHANNEL || process.env.DISCORD_CHANNEL || '';
const AGENT_ID = process.env.PATINA_AGENT_ID || 'patina';
const SESSION_PREFIX = process.env.COMPONENT_BRIDGE_SESSION_PREFIX || 'patina-component-bridge';
const POLL_MS = Number.parseInt(process.env.COMPONENT_BRIDGE_POLL_MS || '4000', 10);
const MAX_SEEN_IDS = Number.parseInt(process.env.COMPONENT_BRIDGE_MAX_SEEN_IDS || '200', 10);
const TIMEOUT_SEC = Number.parseInt(process.env.COMPONENT_BRIDGE_TIMEOUT_SEC || '180', 10);
const ONCE = process.env.COMPONENT_BRIDGE_ONCE === 'true';
const SEED_HISTORY = process.env.COMPONENT_BRIDGE_SEED_HISTORY !== 'false';
const VERBOSE = process.env.COMPONENT_BRIDGE_VERBOSE === 'true';

if (!RUNTIME_CLI) {
  throw new Error('PATINA_RUNTIME_CLI가 필요합니다 (.env 또는 환경 변수 설정)');
}

if (!CHANNEL_ID) {
  throw new Error('DISCORD_CHANNEL 또는 COMPONENT_BRIDGE_CHANNEL이 필요합니다 (.env 또는 환경 변수 설정)');
}

function log(message) {
  console.log(`[component-bridge] ${message}`);
}

function runRuntimeCli(args) {
  return execFileSync(RUNTIME_CLI, args, {
    cwd: REPO_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.local/bin:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
    },
  });
}

function runJson(args) {
  return JSON.parse(runRuntimeCli(args));
}

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return {
      seenIds: [],
      selfBotId: process.env.COMPONENT_BRIDGE_SELF_BOT_ID || '',
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return {
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds.map(String) : [],
      selfBotId: typeof parsed.selfBotId === 'string' ? parsed.selfBotId : (process.env.COMPONENT_BRIDGE_SELF_BOT_ID || ''),
    };
  } catch (error) {
    log(`state load failed; resetting (${error.message})`);
    return {
      seenIds: [],
      selfBotId: process.env.COMPONENT_BRIDGE_SELF_BOT_ID || '',
    };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getSelfBotId() {
  const configured = process.env.COMPONENT_BRIDGE_SELF_BOT_ID;
  if (configured) return configured;

  const status = runJson(['channels', 'status', '--probe', '--json']);
  return String(
    status?.channelAccounts?.discord?.[0]?.bot?.id
      || status?.channels?.discord?.probe?.bot?.id
      || ''
  );
}

function readMessages(limit = 20) {
  const result = runJson([
    'message', 'read',
    '--channel', 'discord',
    '--target', `channel:${CHANNEL_ID}`,
    '--limit', String(limit),
    '--json',
  ]);
  return result?.payload?.messages || [];
}

function collectComponentText(components, sink = []) {
  for (const component of components || []) {
    for (const key of ['content', 'label', 'title', 'value']) {
      if (typeof component?.[key] === 'string') {
        const value = component[key].trim();
        if (value) sink.push(value);
      }
    }

    if (Array.isArray(component?.components)) {
      collectComponentText(component.components, sink);
    }
  }
  return sink;
}

function extractComponentOnlyText(message) {
  const content = (message?.content || '').trim();
  if (content) return '';

  const parts = collectComponentText(message?.components || []);
  const unique = [];
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique.join('\n').trim();
}

function shouldBridge(message, selfBotId) {
  const author = message?.author || {};
  if (!author.bot) return false;
  if (selfBotId && String(author.id) === String(selfBotId)) return false;
  return Boolean(extractComponentOnlyText(message));
}

function markSeen(state, messageId) {
  const seen = state.seenIds.filter((id) => id !== String(messageId));
  seen.push(String(messageId));
  state.seenIds = seen.slice(-MAX_SEEN_IDS);
}

function alreadySeen(state, messageId) {
  return state.seenIds.includes(String(messageId));
}

function deliverReply(message) {
  const author = message.author || {};
  const extracted = extractComponentOnlyText(message);
  const prompt = [
    `[Bridge note: This Discord message came from bot ${author.username || author.id} as component-only content.]`,
    'Respond naturally in Korean.',
    '',
    extracted,
  ].join('\n');

  if (VERBOSE) {
    log(`forwarding ${message.id} from ${author.username || author.id}: ${JSON.stringify(extracted)}`);
  } else {
    log(`forwarding component-only bot message ${message.id} from ${author.username || author.id}`);
  }

  const sessionId = `${SESSION_PREFIX}-${author.id}`;
  const output = runRuntimeCli([
    '--no-color',
    'agent',
    '--agent', AGENT_ID,
    '--session-id', sessionId,
    '--timeout', String(TIMEOUT_SEC),
    '--message', prompt,
    '--deliver',
    '--reply-channel', 'discord',
    '--reply-to', `channel:${CHANNEL_ID}`,
  ]).trim();

  if (output) {
    log(`agent output: ${output.slice(0, 200)}`);
  }
}

async function sleep(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main() {
  const state = loadState();
  if (!state.selfBotId) {
    try {
      state.selfBotId = getSelfBotId();
      saveState(state);
    } catch (error) {
      log(`self bot lookup deferred: ${error.message}`);
    }
  }

  log(`watching channel ${CHANNEL_ID} as self bot ${state.selfBotId || 'unknown'}${ONCE ? ' (once)' : ''}`);

  if (SEED_HISTORY && state.seenIds.length === 0) {
    const initialMessages = readMessages(30);
    for (const message of initialMessages) {
      markSeen(state, message.id);
    }
    saveState(state);
    log(`seeded ${initialMessages.length} recent messages`);
  }

  while (true) {
    try {
      if (!state.selfBotId) {
        state.selfBotId = getSelfBotId();
        saveState(state);
        log(`resolved self bot id: ${state.selfBotId}`);
      }

      const messages = readMessages(20).slice().reverse();
      for (const message of messages) {
        if (alreadySeen(state, message.id)) continue;
        markSeen(state, message.id);
        saveState(state);

        if (!shouldBridge(message, state.selfBotId)) continue;
        deliverReply(message);
      }
    } catch (error) {
      log(`poll failed: ${error.message}`);
    }

    if (ONCE) break;
    await sleep(POLL_MS);
  }
}

main().catch((error) => {
  console.error(`[component-bridge] fatal: ${error.stack || error.message}`);
  process.exit(1);
});
