import { readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return ['.md', '.mdx'].includes(extname(entry.name)) ? [path] : [];
  });
}

export default function patinaAudit({
  contentDir = 'src/content',
  lang = 'en',
  threshold = 30,
  backend = process.env.PATINA_BACKEND,
  patinaBin = process.env.PATINA_BIN || 'npx',
} = {}) {
  const patinaPrefixArgs = process.env.PATINA_BIN ? [] : ['--yes', 'patina-cli'];

  return {
    name: 'patina-audit',
    hooks: {
      'astro:build:start': () => {
        const files = markdownFiles(resolve(contentDir));
        if (files.length === 0) return;
        const args = [...patinaPrefixArgs, '--lang', lang, '--score', '--exit-on', String(threshold), '--batch', ...files];
        if (backend) args.push('--backend', backend);
        const result = spawnSync(patinaBin, args, { stdio: 'inherit' });
        if (result.status !== 0) {
          throw new Error(`Patina score gate failed with exit code ${result.status}`);
        }
      },
    },
  };
}
