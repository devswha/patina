import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPack } from '../../src/commands/pack.js';
import { loadPatterns } from '../../src/loader.js';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const PACK_BODY = '---\nversion: 1.0.0\npatterns: 1\n---\n\n## KO-S1: sample\n';

function serverFetch({ manifestPacks, contents }) {
  return async (url, opts = {}) => {
    const auth = opts.headers?.authorization || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ') {
      return { ok: false, status: 401, json: async () => ({ reason: 'LICENSE_REQUIRED' }) };
    }
    const u = new URL(String(url));
    const id = u.searchParams.get('id');
    if (!id) return { ok: true, status: 200, json: async () => ({ packs: manifestPacks }) };
    const pack = contents[id];
    if (!pack) return { ok: false, status: 404, json: async () => ({ reason: 'PACK_NOT_FOUND' }) };
    return { ok: true, status: 200, json: async () => pack };
  };
}

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'patina-pack-'));
  const manifestPacks = [
    { id: 'ko-structure', version: '1.0.0', kind: 'pattern', lang: 'ko', description: 'structural tells', sha256: sha256(PACK_BODY) },
    { id: 'ko-pro-lex', version: '2.0.0', kind: 'lexicon', lang: 'ko', description: 'pro lexicon', sha256: sha256('lex body') },
  ];
  const contents = {
    'ko-structure': { id: 'ko-structure', version: '1.0.0', kind: 'pattern', lang: 'ko', sha256: sha256(PACK_BODY), content: PACK_BODY },
    'ko-pro-lex': { id: 'ko-pro-lex', version: '2.0.0', kind: 'lexicon', lang: 'ko', sha256: sha256('lex body'), content: 'lex body' },
  };
  return { repoRoot, manifestPacks, contents };
}

const baseArgs = ['--license', 'k', '--url', 'https://packs.test/api/packs'];

test('pack install writes a pattern pack into custom/patterns and it becomes loadable', async () => {
  const { repoRoot, manifestPacks, contents } = fixture();
  try {
    await runPack(['install', 'ko-structure', ...baseArgs], {
      fetchImpl: serverFetch({ manifestPacks, contents }),
      repoRoot,
    });
    const dest = join(repoRoot, 'custom', 'patterns', 'ko-structure.md');
    assert.equal(existsSync(dest), true);
    assert.equal(readFileSync(dest, 'utf8'), PACK_BODY);

    // and the loader actually discovers it (patterns/ can be absent entirely)
    mkdirSync(join(repoRoot, 'patterns'), { recursive: true });
    const packs = loadPatterns(repoRoot, 'ko');
    assert.deepEqual(packs.map((p) => p.file), ['ko-structure.md']);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('pack install refuses a sha mismatch', async () => {
  const { repoRoot, manifestPacks, contents } = fixture();
  contents['ko-structure'] = { ...contents['ko-structure'], content: PACK_BODY + 'tampered' };
  try {
    await assert.rejects(
      runPack(['install', 'ko-structure', ...baseArgs], { fetchImpl: serverFetch({ manifestPacks, contents }), repoRoot }),
      /integrity/
    );
    assert.equal(existsSync(join(repoRoot, 'custom', 'patterns', 'ko-structure.md')), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('lexicon install never clobbers an existing custom lexicon without --force', async () => {
  const { repoRoot, manifestPacks, contents } = fixture();
  try {
    mkdirSync(join(repoRoot, 'custom', 'lexicon'), { recursive: true });
    writeFileSync(join(repoRoot, 'custom', 'lexicon', 'ai-ko.md'), 'hand-maintained');
    await assert.rejects(
      runPack(['install', 'ko-pro-lex', ...baseArgs], { fetchImpl: serverFetch({ manifestPacks, contents }), repoRoot }),
      /overwrite/
    );
    assert.equal(readFileSync(join(repoRoot, 'custom', 'lexicon', 'ai-ko.md'), 'utf8'), 'hand-maintained');

    await runPack(['install', 'ko-pro-lex', '--force', ...baseArgs], { fetchImpl: serverFetch({ manifestPacks, contents }), repoRoot });
    assert.equal(readFileSync(join(repoRoot, 'custom', 'lexicon', 'ai-ko.md'), 'utf8'), 'lex body');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('missing license is an input error before any network call', async () => {
  const { repoRoot } = fixture();
  const prev = process.env.PATINA_LICENSE_KEY;
  delete process.env.PATINA_LICENSE_KEY;
  try {
    await assert.rejects(
      runPack(['list', '--url', 'https://packs.test/api/packs'], {
        fetchImpl: async () => { throw new Error('must not fetch'); },
        repoRoot,
      }),
      /license/i
    );
  } finally {
    if (prev !== undefined) process.env.PATINA_LICENSE_KEY = prev;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('unknown pack id fails before download; --all installs everything', async () => {
  const { repoRoot, manifestPacks, contents } = fixture();
  try {
    await assert.rejects(
      runPack(['install', 'nope', ...baseArgs], { fetchImpl: serverFetch({ manifestPacks, contents }), repoRoot }),
      /unknown pack/
    );
    await runPack(['install', '--all', ...baseArgs], { fetchImpl: serverFetch({ manifestPacks, contents }), repoRoot });
    assert.equal(existsSync(join(repoRoot, 'custom', 'patterns', 'ko-structure.md')), true);
    assert.equal(existsSync(join(repoRoot, 'custom', 'lexicon', 'ai-ko.md')), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('custom/patterns shadows a built-in pack with the same filename', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'patina-shadow-'));
  try {
    mkdirSync(join(repoRoot, 'patterns'), { recursive: true });
    mkdirSync(join(repoRoot, 'custom', 'patterns'), { recursive: true });
    writeFileSync(join(repoRoot, 'patterns', 'ko-base.md'), '---\nv: 1\n---\nbuiltin');
    writeFileSync(join(repoRoot, 'custom', 'patterns', 'ko-base.md'), '---\nv: 2\n---\ncustom wins');
    writeFileSync(join(repoRoot, 'custom', 'patterns', 'ko-extra.md'), '---\nv: 1\n---\nextra');
    const packs = loadPatterns(repoRoot, 'ko');
    assert.deepEqual(packs.map((p) => p.file), ['ko-base.md', 'ko-extra.md']);
    assert.match(packs[0].body, /custom wins/);
    // skipPatterns applies to custom packs too
    const skipped = loadPatterns(repoRoot, 'ko', ['ko-extra']);
    assert.deepEqual(skipped.map((p) => p.file), ['ko-base.md']);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
