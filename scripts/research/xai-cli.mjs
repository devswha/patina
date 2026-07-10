// Minimal stdin->stdout shim over the xAI chat-completions API, so the
// rewrite-efficacy harness can treat grok exactly like the other judge CLIs
// (spawn, write prompt to stdin, read the reply from stdout).
//
// Study 1 panel member `judge-grok` (see 2026-rewrite-efficacy-prereg.md,
// Study 1 section) and rotation generator for the ko document corpus.
//
// Env: XAI_API_KEY (required). XAI_MODEL overrides the default model.
// Usage: echo "prompt" | node scripts/research/xai-cli.mjs

const API_KEY = process.env.XAI_API_KEY;
const MODEL = process.env.XAI_MODEL || 'grok-4.5';
const TIMEOUT_MS = Number(process.env.XAI_TIMEOUT_MS || 110_000);

if (!API_KEY) {
  console.error('xai-cli: XAI_API_KEY is not set');
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const prompt = (await readStdin()).trim();
  if (!prompt) {
    console.error('xai-cli: empty stdin');
    process.exit(2);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1,
      }),
    });
  } catch (e) {
    console.error(`xai-cli: request failed: ${e?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e?.message ?? e}`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();
  if (!res.ok) {
    // Keep the tail on stderr: a quota error must stay distinguishable from a
    // formatting error (Study 0 Deviation 3 was invisible for exactly this reason).
    console.error(`xai-cli: HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
    process.exit(1);
  }

  let content;
  try {
    content = JSON.parse(bodyText)?.choices?.[0]?.message?.content;
  } catch {
    console.error(`xai-cli: unparseable API response: ${bodyText.slice(0, 300)}`);
    process.exit(1);
  }
  if (typeof content !== 'string' || !content.trim()) {
    console.error(`xai-cli: empty completion: ${bodyText.slice(0, 300)}`);
    process.exit(1);
  }
  process.stdout.write(content);
}

main();
