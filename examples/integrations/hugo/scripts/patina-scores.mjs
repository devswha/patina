#!/usr/bin/env node
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [contentDir = 'content', outPath = 'data/patina-scores.json'] = process.argv.slice(2);
const threshold = Number(process.env.PATINA_THRESHOLD || 30);
const lang = process.env.PATINA_LANG || 'en';
const backend = process.env.PATINA_BACKEND;
const patinaBin = process.env.PATINA_BIN || 'npx';
const patinaPrefixArgs = process.env.PATINA_BIN ? [] : ['--yes', 'patina-cli'];

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return ['.md', '.mdx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function scoreFile(path) {
  const args = [...patinaPrefixArgs, '--lang', lang, '--score', '--format', 'json', path];
  if (backend) args.push('--backend', backend);
  const result = spawnSync(patinaBin, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`patina failed for ${path}: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  return {
    path: relative(process.cwd(), path),
    overall: parsed.score?.overall ?? parsed.overall,
    threshold,
  };
}

const scores = Object.fromEntries(markdownFiles(resolve(contentDir)).map((file) => {
  const score = scoreFile(file);
  return [score.path, score];
}));

mkdirSync(resolve(outPath, '..'), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(scores, null, 2)}\n`);
