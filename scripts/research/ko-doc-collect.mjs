// Collect DOCUMENT-length Korean human controls for Study 1 Arm D
// (pre-registration: 2026-rewrite-efficacy-prereg.md, "Study 1" section).
//
// The rebaseline collector (scripts/rebaseline-web-collect.mjs) extracts
// paragraph snippets (90-700 chars) — that snippet-only shape is exactly the
// blocking gap Study 0 named. This script reuses its source inventory, script
// filters, and boilerplate rejection, but keeps a page's consecutive accepted
// paragraphs TOGETHER as one document: >= MIN_PARAS paragraphs, MIN/MAX_CHARS
// total. One document per source page.
//
// Raw text stays gitignored under artifacts/rewrite-efficacy-study1/; only
// hashes/metadata are ever committed. Same redistribution policy as every
// prior corpus in this repo.
//
// Usage: node scripts/research/ko-doc-collect.mjs [--dry-run]

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadSourceRows,
  extractTextCandidates,
  DEFAULT_SOURCE_INPUT,
} from '../rebaseline-web-collect.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const OUT = join(OUT_DIR, 'ko-human-docs.private.jsonl');
const DRY = process.argv.includes('--dry-run');

// Pre-registered document shape (Arm D, human side).
const MIN_PARAS = 3;
const MIN_CHARS = 1200;
const MAX_CHARS = 4000;
// Per-paragraph bounds: reuse the collector's quality filters but let a single
// paragraph run longer than the snippet cap — articles have long paragraphs.
const PARA_MIN = 60;
const PARA_MAX = 2000;
const DELAY_MS = 400;

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'patina-rebaseline-corpus-builder/1.0 (+https://github.com/devswha/patina)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Join the page's accepted paragraphs, in page order, into one document.
 * extractTextCandidates already applies script-ratio, boilerplate, and URL
 * filters per paragraph and preserves page order; the document is simply the
 * accepted run, capped at MAX_CHARS on a paragraph boundary.
 */
function toDocument(html) {
  const paras = extractTextCandidates(html, { language: 'ko', minChars: PARA_MIN, maxChars: PARA_MAX });
  const kept = [];
  let total = 0;
  for (const p of paras) {
    if (total + p.length > MAX_CHARS) break;
    kept.push(p);
    total += p.length + 2;
  }
  if (kept.length < MIN_PARAS || total < MIN_CHARS) return null;
  return kept.join('\n\n');
}

async function main() {
  const loaded = loadSourceRows(DEFAULT_SOURCE_INPUT);
  if (loaded.errors.length) {
    console.error('source inventory errors:', loaded.errors.join('; '));
    process.exit(1);
  }

  const rows = [];
  const skipped = [];
  for (const { value: src } of loaded.rows) {
    try {
      const html = await fetchHtml(src.url);
      const doc = toDocument(html);
      if (!doc) {
        skipped.push(`${src.source_id}: page yields no >=${MIN_PARAS}-paragraph document in [${MIN_CHARS}, ${MAX_CHARS}] chars`);
      } else {
        rows.push({
          sample_id: `s1-ko-human-${src.source_id}`,
          language: 'ko',
          class: 'natural-human',
          register: src.register,
          model_family: 'human-reference',
          provider: 'web-human-control',
          model: 'human-authored-web-document',
          source_url: src.url,
          source_title: src.source_title,
          source_license: src.source_license,
          ...(src.source_published_at ? { source_published_at: src.source_published_at } : {}),
          collected_at: new Date().toISOString().slice(0, 10),
          paragraphs: doc.split('\n\n').length,
          chars: doc.length,
          text_hash: sha(doc),
          text: doc,
        });
        console.log(`ok  ${src.source_id} [${src.register}] ${doc.length} chars, ${doc.split('\n\n').length} paras`);
      }
    } catch (e) {
      skipped.push(`${src.source_id}: ${e?.message ?? e}`);
    }
    await sleep(DELAY_MS);
  }

  // Every dropped source is listed — silent truncation is a protocol violation.
  const byRegister = rows.reduce((m, r) => { m[r.register] = (m[r.register] ?? 0) + 1; return m; }, {});
  console.log(`\ncollected ${rows.length}/${loaded.rows.length} documents`);
  console.log('by register:', JSON.stringify(byRegister));
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`);
    for (const s of skipped) console.log(`- ${s}`);
  }

  if (!DRY) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    console.log(`\n[written] ${OUT}`);
  }
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
