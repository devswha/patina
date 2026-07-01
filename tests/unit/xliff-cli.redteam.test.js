import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs, validateXliffRequest } from '../../src/cli/args.js';
import { humanizeXliffDocument } from '../../src/cli/xliff.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, '../fixtures/xliff/sample.xliff'), 'utf8');

const KO_A = '첫 번째 문장은 사람이 읽기 좋게 다듬을 수 있는 충분히 긴 번역문입니다.';
const KO_B = '두 번째 문장도 검증 경계값을 확인하기에 충분한 한국어 번역문입니다.';
const KO_C = '세 번째 문장은 변경하지 않는 경로를 확인하기 위해 준비한 문장입니다.';
const xml = (units) => `<xliff version="1.2"><file target-language="ko"><body>${units}</body></file></xliff>`;
const unit = (id, target) => `<trans-unit id="${id}"><source>Source text ${id}</source><target state="translated">${target}</target></trans-unit>`;

test('parseArgs/validateXliffRequest: fail closed for XLIFF-only flags and does not interfere with normal score', () => {
  for (const argv of [
    ['--xliff', '--audit', 'f.xliff'],
    ['--xliff', '--verify', 'f.xliff'],
    ['--xliff', '--tone', 'casual', 'f.xliff'],
    ['--xliff', '--persona', 'x', 'f.xliff'],
    ['--xliff', '--jargon', 'remove', 'f.xliff'],
    ['--xliff', '--score', 'f.xliff'],
    ['--xliff', '--preview', 'f.xliff'],
  ]) {
    assert.throws(() => validateXliffRequest(parseArgs(argv)), /cannot be combined with --xliff/);
  }

  assert.throws(() => validateXliffRequest(parseArgs(['--xliff'])), /requires file paths, not stdin/);
  assert.throws(() => validateXliffRequest(parseArgs(['--xliff', 'a.xliff', 'b.xliff'])), /requires --batch/);
  assert.throws(() => validateXliffRequest(parseArgs(['--dry-run', 'a.md'])), /--dry-run requires --xliff/);
  assert.throws(() => validateXliffRequest(parseArgs(['--max-segments', '5', 'a.md'])), /--max-segments requires --xliff/);

  for (const argv of [
    ['--xliff', '--max-segments', '0', 'f.xliff'],
    ['--xliff', '--max-segments', '-1', 'f.xliff'],
    ['--xliff', '--max-segments', 'NaN', 'f.xliff'],
  ]) {
    assert.throws(() => parseArgs(argv), /positive integer/);
  }

  const normal = parseArgs(['--score']);
  assert.equal(normal.score, true);
  assert.doesNotThrow(() => validateXliffRequest(normal));
});

test('humanize orchestration: mixed rewritten, floor-failed, and unchanged keys preserve byte integrity', async () => {
  const doc = xml(unit('rewrite', KO_A) + unit('floor', KO_B) + unit('unchanged', KO_C));
  const originalFloor = `<target state="translated">${KO_B}</target>`;
  const originalUnchanged = `<target state="translated">${KO_C}</target>`;

  const result = await humanizeXliffDocument({
    xml: doc,
    rewriteSegment: async ({ core }) => {
      if (core === KO_A) return `${core} 자연스럽게`;
      if (core === KO_B) return `${core} 망가짐`;
      return core;
    },
    verifySegment: async ({ core, candidate }) => {
      if (core === KO_B) return { verified: false, text: candidate, mps: 20, fidelity: 30 };
      return { verified: true, text: candidate };
    },
  });

  assert.equal(result.report.changedUniqueKeys, 1);
  assert.equal(result.report.changedSegments, 1);
  assert.equal(result.outputXml.includes('자연스럽게'), true);
  assert.equal(result.outputXml.includes(originalFloor), true);
  assert.equal(result.outputXml.includes(originalUnchanged), true);
  assert.equal(result.outputXml.includes('망가짐'), false);
  assert.equal(result.report.perKey[KO_B].status, 'floor_failed');
  assert.equal(result.report.perKey[KO_C].status, 'unchanged');
});

test('humanize orchestration: breaker stop throws typed breaker error and leaves caller without partial output', async () => {
  const failures = [];
  const breakerError = new Error('breaker open');
  breakerError.code = 'breaker_open';
  const breaker = {
    recordSuccess() {},
    recordFailure(failure) { failures.push(failure); },
    shouldStop() { return true; },
    toError() { return breakerError; },
  };

  await assert.rejects(
    () => humanizeXliffDocument({
      xml: FIXTURE,
      breaker,
      rewriteSegment: async () => { throw new Error('backend down'); },
      verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
    }),
    (err) => err.code === 'breaker_open'
  );
  assert.equal(failures.length, 1);
});

test('humanize orchestration: cap boundary allows exactly capped unique count and rejects one below before calls', async () => {
  let calls = 0;
  const ok = await humanizeXliffDocument({
    xml: FIXTURE,
    cap: 2,
    rewriteSegment: async ({ core }) => { calls++; return `${core} 통과`; },
    verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
  });
  assert.equal(ok.report.changedUniqueKeys, 2);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    () => humanizeXliffDocument({
      xml: FIXTURE,
      cap: 1,
      rewriteSegment: async ({ core }) => { calls++; return `${core} 안됨`; },
      verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
    }),
    (err) => err.code === 'xliff_cap_exceeded'
  );
  assert.equal(calls, 0);
});
