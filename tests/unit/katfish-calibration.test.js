import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateCalibration,
  loadKatfishRows,
  normalizeKatfishRow,
  renderMarkdownReport,
} from '../../scripts/katfish-calibration.mjs';

test('normalizeKatfishRow maps KatFish labels without exposing raw text in reports', () => {
  const row = normalizeKatfishRow({
    index: 7,
    text: '아침 회의는 기록을 확인합니다. 담당자는 결과를 공유합니다.',
    written_by: 'gpt-4o-2024-05-13',
    label: 1,
  }, { genre: 'essay', lineNumber: 1 });

  assert.equal(row.id, 'essay:7');
  assert.equal(row.genre, 'essay');
  assert.equal(row.model, 'gpt-4o-2024-05-13');
  assert.equal(row.expectedHot, true);
});

test('loadKatfishRows validates the three private KatFish JSONL files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-katfish-'));
  try {
    for (const file of ['essay.jsonl', 'abstract.jsonl', 'poetry.jsonl']) {
      writeFileSync(join(dir, file), [
        JSON.stringify({
          index: 1,
          text: '이 문장은 테스트를 위한 한국어 예시입니다. 결과를 확인합니다.',
          written_by: 'human',
          label: 0,
        }),
      ].join('\n') + '\n');
    }

    const loaded = loadKatfishRows(dir);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.rows.length, 3);
    assert.deepEqual([...new Set(loaded.rows.map((row) => row.genre))].sort(), [
      'abstract',
      'essay',
      'poetry',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateCalibration returns aggregate metrics and markdown omits source text', () => {
  const katfishRows = [
    {
      id: 'essay:1',
      genre: 'essay',
      model: 'human',
      expectedHot: false,
      text: '사람이 쓴 예시는 문장 길이가 조금씩 다릅니다. 쉼표도 가끔 쓰고, 표현도 조금 흔들립니다.',
    },
    {
      id: 'essay:2',
      genre: 'essay',
      model: 'gpt-4o-2024-05-13',
      expectedHot: true,
      text:
        '아침 회의는 기록을 확인합니다. 담당자는 오늘 진행할 항목을 차례대로 검토합니다. ' +
        '화면은 변경된 값을 보여주고 팀은 같은 절차를 다시 확인합니다. 마지막으로 결과는 공유합니다.',
    },
  ];
  const humanControlRows = [
    {
      id: 'web:1',
      register: 'blog',
      expectedHot: false,
      text: '블로그 글은 가끔 옆길로 샙니다. 그래서 문장이 조금 짧다가도, 갑자기 길어질 때가 있습니다.',
    },
  ];

  const summary = evaluateCalibration({ katfishRows, humanControlRows });
  assert.equal(summary.inputs.katfishRows, 2);
  assert.equal(summary.inputs.humanControlRows, 1);
  assert.equal(summary.katfish.metrics.patina_current.total, 2);

  const markdown = renderMarkdownReport(summary, {
    katfishPath: 'private/katfish',
    humanControlsPath: 'private/human.jsonl',
  });
  assert.match(markdown, /KatFish Korean Calibration/);
  assert.doesNotMatch(markdown, /아침 회의는 기록을 확인합니다/);
  assert.doesNotMatch(JSON.stringify(summary), /아침 회의는 기록을 확인합니다/);
});
