import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const FILLER_PACKS = {
  en: join(REPO_ROOT, 'patterns/en-filler.md'),
  ko: join(REPO_ROOT, 'patterns/ko-filler.md'),
  zh: join(REPO_ROOT, 'patterns/zh-filler.md'),
  ja: join(REPO_ROOT, 'patterns/ja-filler.md'),
};

const DOCS = {
  en: join(REPO_ROOT, 'docs/PATTERNS-EN.md'),
  ko: join(REPO_ROOT, 'docs/PATTERNS-KO.md'),
  zh: join(REPO_ROOT, 'docs/PATTERNS-ZH.md'),
  ja: join(REPO_ROOT, 'docs/PATTERNS-JA.md'),
};

// Lesson-closer / thematic-commentary vocabulary folded into pattern 31 (#889).
// The 02 example pair exercises exactly this aspect, so pin the pack rule it
// depends on: if a future pack edit drops this vocabulary, the 02 examples
// would document a rule that no longer exists.
const LESSON_VOCAB = {
  en: [/This taught me/, /what this story shows/i],
  ko: [/배웠습니다/, /보여주는 것은/],
  zh: [/这让我明白/, /说明的是/],
  ja: [/学びました/, /が示すのは/],
};

function pattern31Section(raw, path) {
  const start = raw.search(/^### 31\./m);
  assert.notEqual(start, -1, `${path} must contain ### 31.`);
  const rest = raw.slice(start);
  const next = rest.slice('### 31.'.length).search(/^### /m);
  return next === -1 ? rest : rest.slice(0, '### 31.'.length + next);
}

test('each filler pack keeps the lesson-closer vocabulary inside pattern 31', () => {
  for (const [lang, packPath] of Object.entries(FILLER_PACKS)) {
    const section = pattern31Section(readFileSync(packPath, 'utf8'), packPath);
    for (const re of LESSON_VOCAB[lang]) {
      assert.ok(re.test(section), `${packPath} pattern 31 must keep ${re}`);
    }
  }
});

test('pattern 31 ships the lesson-closer example pair in all four languages', () => {
  for (const [lang, prefix] of Object.entries({ ko: '', en: 'en-', zh: 'zh-', ja: 'ja-' })) {
    const success = join(REPO_ROOT, `examples/${prefix}31-success-02.md`);
    const failure = join(REPO_ROOT, `examples/${prefix}31-failure-02.md`);
    const successRaw = readFileSync(success, 'utf8');
    const failureRaw = readFileSync(failure, 'utf8');

    for (const [path, raw, type] of [[success, successRaw, 'success'], [failure, failureRaw, 'failure']]) {
      assert.match(raw, /^pattern: 31$/m, `${path} must reference pattern 31`);
      assert.match(raw, new RegExp(`^type: ${type}$`, 'm'), `${path} must declare ${type}`);
      assert.match(raw, new RegExp(`^pack: (ko|en|zh|ja)-filler$`, 'm'), `${path} must stay in a filler pack`);
    }

    // The failure case is a false-positive guard: a "lessons learned" list that
    // IS the deliverable must not fire. It must say so explicitly.
    assert.match(
      failureRaw,
      /No correction|수정 없음|不修改|修正なし/,
      `${failure} must mark a no-correction / false-positive case`,
    );

    // The success case must delete only the lesson sentence; every concrete
    // claim of the input has to survive verbatim in the expected output.
    const input = [...successRaw.matchAll(/^> (.+)$/gm)].map((m) => m[1]);
    assert.ok(input.length >= 2, `${success} must quote input and expected output`);
    const source = input[0];
    const expected = input[1];
    assert.ok(source.length > expected.length, `${success}: the expected output must be shorter than the input`);
    for (const claim of [/40\s*분|forty minutes|40\s*分|四十分钟/, /에튀드|étude|エチュード|练习曲/]) {
      assert.ok(claim.test(expected), `${success}: concrete practice claims must survive (${claim})`);
    }

    // The language reference page links the second pair.
    const docLine = readFileSync(DOCS[lang], 'utf8');
    assert.ok(
      docLine.includes(`[failure 02](../examples/${prefix}31-failure-02.md)`)
        && docLine.includes(`[success 02](../examples/${prefix}31-success-02.md)`),
      `${DOCS[lang]} must link the 31 example 02 pair`,
    );
  }
});
