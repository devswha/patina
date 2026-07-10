// Generate the AI side of Study 1 Arm D: for each collected ko human document,
// ONE topic-paired AI document (pre-registration, "Study 1" section).
//
// Pairing rule: the generation prompt sees ONLY the human document's public
// title, its register, and a length band derived from its char count. The human
// text itself never enters the prompt — pairing controls topic and register
// without leaking phrasing.
//
// Family rotation is deterministic: human docs sorted by sample_id, family =
// rotation[index % 4]. No randomness anywhere, so re-runs assign identically.
//
// Raw text stays gitignored under artifacts/rewrite-efficacy-study1/.
//
// Usage:
//   node scripts/research/ko-doc-generate.mjs [--families gpt-family,claude-family]
//   (resumes by default: sample_ids already in the output file are skipped)

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const HUMAN = join(DIR, 'ko-human-docs.private.jsonl');
const OUT = join(DIR, 'ko-ai-docs.private.jsonl');

const ROTATION = ['gpt-family', 'claude-family', 'moonshot-family', 'xai-family'];
const FAMILIES = {
  'gpt-family': { provider: 'codex-cli', model: 'gpt-5.5' },
  'claude-family': { provider: 'claude-cli', model: 'claude-sonnet-4-6' },
  'moonshot-family': { provider: 'kimi-cli', model: 'kimi-k2.5' },
  'xai-family': { provider: 'xai-api', model: process.env.XAI_MODEL || 'grok-4-fast-non-reasoning' },
};

const REGISTER_DESC = {
  blog: '기술 회사 블로그에 올릴 에세이 형식의 글',
  'academic-summary': '연구·정책 동향을 요약하는 보고서 형식의 글',
  'product-doc': '개발자를 위한 제품 문서·안내 형식의 글',
  'chat-update': '정책·사업 소식을 전하는 보도자료 형식의 글',
  'technical-how-to': '기술 개념이나 방법을 설명하는 해설 형식의 글',
};

const TIMEOUT_MS = 8 * 60 * 1000;
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const onlyFamilies = (() => {
  const i = process.argv.indexOf('--families');
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
})();

function run(cmd, args, { input = '', timeout = TIMEOUT_MS, cwd = ROOT } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise(v); } };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
      finish({ ok: false, stdout, stderr, error: `timeout after ${timeout}ms` });
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ ok: false, stdout, stderr, error: String(e?.message ?? e) }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function genPrompt(title, register, minCh, maxCh) {
  return [
    `다음 제목으로 ${REGISTER_DESC[register] ?? '글'}을 한국어로 작성하세요.`,
    '',
    `제목: ${title}`,
    '',
    `조건:`,
    `- 분량 ${minCh}~${maxCh}자`,
    '- 최소 4개 문단, 문단 사이는 빈 줄로 구분',
    '- 제목이나 헤딩 없이 본문만 출력',
    '- 마크다운 문법(#, *, - 목록 등) 없이 일반 산문으로',
    '- 설명이나 인사 없이 곧바로 본문 시작',
  ].join('\n');
}

async function invoke(family, prompt) {
  const cfg = FAMILIES[family];
  if (cfg.provider === 'codex-cli') {
    const dir = mkdtempSync(resolve(tmpdir(), 'patina-s1-codex-'));
    const outFile = resolve(dir, 'last-message.txt');
    const res = await run('codex', [
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir,
      '-m', cfg.model, '--output-last-message', outFile,
    ], { input: prompt, cwd: dir });
    const text = existsSync(outFile) ? readFileSync(outFile, 'utf8') : res.stdout;
    rmSync(dir, { recursive: true, force: true });
    if (!res.ok && !text.trim()) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text };
  }
  if (cfg.provider === 'claude-cli') {
    const res = await run('claude', ['-p', '--model', cfg.model, '--output-format', 'text'], { input: prompt });
    if (!res.ok) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text: res.stdout };
  }
  if (cfg.provider === 'kimi-cli') {
    const res = await run('kimi', ['--print', '--input-format', 'text', '--output-format', 'text',
      '--final-message-only', '--no-thinking', '--max-steps-per-turn', '20'], { input: prompt });
    if (!res.ok) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text: res.stdout };
  }
  if (cfg.provider === 'xai-api') {
    const res = await run('node', [join('scripts', 'research', 'xai-cli.mjs')], { input: prompt });
    if (!res.ok) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text: res.stdout };
  }
  return { error: `unknown provider ${cfg.provider}` };
}

/** Strip wrapper noise without editing the prose: code fences, heading lines, session footers. */
function cleanBody(raw) {
  let t = String(raw).replace(/\r/g, '').trim();
  t = t.replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/, '');
  t = t.split('\n').filter((line) => !/^#{1,4}\s/.test(line)).join('\n');
  t = t.replace(/\n?To resume this session:.*$/s, '');
  return t.trim();
}

const paraCount = (t) => t.split(/\n\s*\n/).filter((p) => p.trim()).length;

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function main() {
  const humans = readJsonl(HUMAN).sort((a, b) => a.sample_id.localeCompare(b.sample_id));
  if (!humans.length) { console.error(`no human docs at ${HUMAN} — run ko-doc-collect first`); process.exit(1); }
  mkdirSync(DIR, { recursive: true });
  const done = new Set(readJsonl(OUT).map((r) => r.sample_id));

  let generated = 0;
  let failed = 0;
  let skipped = 0;
  for (const [i, h] of humans.entries()) {
    const family = ROTATION[i % ROTATION.length];
    const sampleId = h.sample_id.replace('-human-', '-ai-');
    if (done.has(sampleId)) { skipped += 1; continue; }
    if (onlyFamilies && !onlyFamilies.has(family)) { skipped += 1; continue; }

    const minCh = Math.max(1200, Math.round(h.chars * 0.75));
    const maxCh = Math.min(4000, Math.round(h.chars * 1.25));
    const prompt = genPrompt(h.source_title, h.register, minCh, maxCh);

    log(`${sampleId} [${family}] target ${minCh}-${maxCh}ch…`);
    let out = await invoke(family, prompt);
    let text = out.text ? cleanBody(out.text) : null;
    // One structured retry if the shape is off (too short / too few paragraphs).
    if (!out.error && text && (text.length < 1000 || paraCount(text) < 3)) {
      log(`  shape off (${text.length}ch, ${paraCount(text)}p) — one retry`);
      out = await invoke(family, prompt + '\n\n(이전 응답이 조건에 미달했습니다. 분량과 문단 수 조건을 지켜 다시 작성하세요.)');
      text = out.text ? cleanBody(out.text) : text;
    }
    if (out.error || !text) {
      failed += 1;
      log(`  FAILED: ${out.error ?? 'empty'}`);
      appendFileSync(join(DIR, 'ko-ai-generate.log'), `${sampleId}\t${family}\tFAILED\t${out.error ?? 'empty'}\n`);
      continue;
    }

    appendFileSync(OUT, JSON.stringify({
      sample_id: sampleId,
      language: 'ko',
      class: 'ai-like',
      register: h.register,
      model_family: family,
      provider: FAMILIES[family].provider,
      model: FAMILIES[family].model,
      pair_id: h.sample_id,
      source_title: h.source_title,
      generated_at: new Date().toISOString().slice(0, 10),
      target_chars: [minCh, maxCh],
      paragraphs: paraCount(text),
      chars: text.length,
      text_hash: sha(text),
      text,
    }) + '\n');
    generated += 1;
    log(`  ok ${text.length}ch, ${paraCount(text)}p`);
  }
  log(`done: ${generated} generated, ${failed} failed, ${skipped} skipped (resume/family filter)`);
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
