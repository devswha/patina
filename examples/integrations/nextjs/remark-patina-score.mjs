import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectText(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text' || node.type === 'inlineCode') out.push(node.value);
  for (const child of node.children || []) collectText(child, out);
  return out;
}

export default function patinaRemark({
  lang = 'en',
  threshold = 30,
  backend = process.env.PATINA_BACKEND,
  patinaBin = process.env.PATINA_BIN || 'npx',
} = {}) {
  const patinaPrefixArgs = process.env.PATINA_BIN ? [] : ['--yes', 'patina-cli'];

  return (tree, file) => {
    const text = collectText(tree).join('\n').trim();
    if (!text) return;

    const dir = mkdtempSync(join(tmpdir(), 'patina-mdx-'));
    const input = join(dir, 'input.md');
    writeFileSync(input, text);

    try {
      const args = [...patinaPrefixArgs, '--lang', lang, '--score', '--format', 'json', input];
      if (backend) args.push('--backend', backend);
      const result = spawnSync(patinaBin, args, { encoding: 'utf8' });
      if (result.status !== 0) {
        file.message(`Patina score unavailable: ${result.stderr || result.stdout}`);
        return;
      }
      const parsed = JSON.parse(result.stdout);
      const overall = parsed.score?.overall ?? parsed.overall;
      if (overall > threshold) {
        file.message(`Patina score ${overall}/100 exceeds threshold ${threshold}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
