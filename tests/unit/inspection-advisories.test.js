import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyDiscourseShape,
  detectInventedLessonCoda,
  detectStarEvenness,
  collectInspectionAdvisories,
} from '../../src/inspection-advisories.js';
import { omitsPortabilityAdvisory } from '../../src/features/portability.js';

const completeArc = [
  'I built a small open-source table classifier last spring.',
  'Header rows with years were read as measurements for two weeks.',
  'A second pass over column names cut those misses.',
  'Four pull requests landed after that change.',
  'This taught me to separate headers from values before anything else.',
].join('\n\n');

const headedNotes = [
  '# Work',
  '',
  '- open-source table classifier',
  '- public repository',
  '',
  '# Problem',
  '',
  '- header rows read as numeric columns',
  '- years in headers treated as measurements',
  '',
  '# Method',
  '',
  '- second pass over column names',
  '',
  '# Result',
  '',
  '- fewer misses',
  '- four pull requests',
].join('\n');

const evenStar = [
  'Situation: the classifier mixed header years with measurements in week one.',
  'Task: keep header rows out of the numeric path without dropping real values.',
  'Action: I added a second pass over column names and reran the twelve issues.',
  'Result: the same miss stopped, and four pull requests landed the next week.',
  'I learned that headers have to be split from values before the rest of the pipeline moves.',
].join('\n\n');

const engineerNotes = [
  '문제: 헤더 연도가 측정값으로 들어갔다.',
  '방법: 열 이름을 한 번 더 본다.',
  '결과: 같은 실수가 줄었다.',
].join('\n\n');

test('discourse shape distinguishes complete prose from headed notes', () => {
  assert.equal(classifyDiscourseShape(completeArc), 'complete-prose');
  assert.equal(classifyDiscourseShape(headedNotes), 'headed-notes');
});

test('0:1 lesson coda fires only on a low-overlap rewrite closer', () => {
  const invented = `${headedNotes}\n\nI learned that headers must never mix with values.`;
  const hit = detectInventedLessonCoda(headedNotes, invented, { lang: 'en' });
  assert.equal(hit.code, 'invented-lesson-coda');
  assert.ok(hit.overlap < 0.28);

  const kept = detectInventedLessonCoda(completeArc, completeArc, { lang: 'en' });
  assert.equal(kept, null);
  assert.equal(detectInventedLessonCoda(headedNotes, '', { lang: 'en' }), null);
});

test('STAR evenness needs all five roles and even shares', () => {
  const hit = detectStarEvenness(evenStar, { lang: 'en' });
  assert.equal(hit.code, 'star-evenness');
  assert.equal(detectStarEvenness(engineerNotes, { lang: 'ko' }), null);
  assert.equal(detectStarEvenness(headedNotes, { lang: 'en' }), null);
});

test('advisories respect document-type suppressions and skip missing rewrite', () => {
  const invented = `${headedNotes}\n\nI learned that headers must never mix with values.`;
  const defaultHit = collectInspectionAdvisories(headedNotes, {
    language: 'en',
    documentType: 'default',
    rewrite: invented,
  });
  assert.ok(defaultHit.some((row) => row.code === 'invented-lesson-coda'));

  const academic = collectInspectionAdvisories(headedNotes, {
    language: 'en',
    documentType: 'academic',
    rewrite: invented,
  });
  assert.equal(academic.length, 0);

  const starOnProject = collectInspectionAdvisories(evenStar, {
    language: 'en',
    documentType: 'project-writeup',
  });
  assert.ok(starOnProject.some((row) => row.code === 'star-evenness'));

  const starOnFormal = collectInspectionAdvisories(evenStar, {
    language: 'en',
    documentType: 'formal',
  });
  assert.equal(starOnFormal.length, 0);
});

test('the portability probe stays quiet in impersonal registers (#881)', () => {
  // A paragraph that is portable by construction: no numbers, no proper nouns.
  const portable = [
    'Our platform helps teams move faster and work smarter.',
    'We believe great products come from listening to users.',
    'The result is a better experience for everyone involved.',
  ].join(' ');
  const flagged = collectInspectionAdvisories(portable, { language: 'en', documentType: 'default' });
  assert.ok(flagged.some((row) => row.code === 'portable-generic-prose'), 'fires on a default draft');

  for (const documentType of ['academic', 'legal', 'formal', 'medical', 'technical']) {
    assert.equal(omitsPortabilityAdvisory(documentType), true, documentType);
    const rows = collectInspectionAdvisories(portable, { language: 'en', documentType });
    assert.ok(
      !rows.some((row) => row.code === 'portable-generic-prose'),
      `${documentType} is an impersonal register; portable prose is correct there`,
    );
  }
});
