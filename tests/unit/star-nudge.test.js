import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  STAR_COMMAND,
  STAR_NUDGE_AT,
  STAR_URL,
  formatStarNudge,
  maybeStarNudge,
  recordSuccessfulRun,
  skillStarNotice,
  starNudgeEnabled,
} from '../../src/star-nudge.js';
import { runDefault } from '../../src/cli/run.js';
import { parseArgs } from '../../src/cli/args.js';

function stateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-star-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'state');
}

function collectLogger() {
  const events = [];
  const record = (level) => (event, fields) => events.push({ level, event, message: fields?.message });
  return { events, debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
}

const TTY = { isTTY: true };
const QUIET_ENV = {}; // no CI, no opt-out

test('reminder is due on the 3rd and 20th successful run and never again', (t) => {
  const dir = stateDir(t);
  const dueAt = [];
  for (let run = 1; run <= 60; run++) {
    if (recordSuccessfulRun({ stateDir: dir }).due) dueAt.push(run);
  }
  assert.deepEqual(dueAt, [...STAR_NUDGE_AT]);
});

test('counter file is private and stops being rewritten once both showings are spent', (t) => {
  const dir = stateDir(t);
  for (let run = 1; run <= 20; run++) recordSuccessfulRun({ stateDir: dir, now: () => new Date('2026-09-19T00:00:00Z') });
  const file = join(dir, 'star-nudge.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved, { version: 1, successes: 20, shown: 2, lastShownAt: '2026-09-19T00:00:00.000Z' });
  assert.deepEqual(readdirSync(dir), ['star-nudge.json'], 'no temp file is left behind');
  if (process.platform !== 'win32') {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
  const before = statSync(file).mtimeMs;
  const after = recordSuccessfulRun({ stateDir: dir });
  assert.deepEqual(after, { due: false, successes: 20, shown: 2 });
  assert.equal(statSync(file).mtimeMs, before);
});

test('a corrupt or hostile counter starts over instead of throwing', (t) => {
  const dir = stateDir(t);
  recordSuccessfulRun({ stateDir: dir });
  for (const junk of ['not json', '[]', 'null', '{"successes":-4,"shown":"2"}', '{"successes":1e400,"shown":{}}']) {
    writeFileSync(join(dir, 'star-nudge.json'), junk);
    assert.deepEqual(recordSuccessfulRun({ stateDir: dir }), { due: false, successes: 1, shown: 0 }, junk);
  }
});

test('an unwritable or symlinked state directory never shows the reminder', { skip: process.platform === 'win32' }, (t) => {
  const dir = stateDir(t);
  // Two runs persisted, then the directory turns read-only right before the 3rd.
  recordSuccessfulRun({ stateDir: dir });
  recordSuccessfulRun({ stateDir: dir });
  chmodSync(dir, 0o500);
  try {
    if (process.getuid?.() !== 0) {
      assert.equal(recordSuccessfulRun({ stateDir: dir }).due, false, 'an unpersisted count must not show the line on every run');
    }
  } finally {
    chmodSync(dir, 0o700); // the temp-root cleanup needs a writable directory again
  }

  const link = `${dir}-link`;
  symlinkSync(dir, link);
  t.after(() => rmSync(link, { force: true }));
  assert.equal(recordSuccessfulRun({ stateDir: link }).due, false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'star-nudge.json'), 'utf8')).successes, 2, 'nothing was written through the symlink');
});

test('opt-outs: config key, env flag, and CI', () => {
  assert.equal(starNudgeEnabled({ config: {}, env: {} }), true);
  assert.equal(starNudgeEnabled({ config: { 'star-nudge': true }, env: {} }), true);
  assert.equal(starNudgeEnabled({ config: { 'star-nudge': false }, env: {} }), false);
  assert.equal(starNudgeEnabled({ config: {}, env: { PATINA_NO_STAR_NUDGE: '1' } }), false);
  assert.equal(starNudgeEnabled({ config: {}, env: { CI: 'true' } }), false);
  for (const off of ['', '0', 'false', 'FALSE']) {
    assert.equal(starNudgeEnabled({ config: {}, env: { CI: off, PATINA_NO_STAR_NUDGE: off } }), true, `"${off}" is not an opt-out`);
  }
});

test('CLI hook prints one info line through the logger on the 3rd eligible run', (t) => {
  const dir = stateDir(t);
  const logger = collectLogger();
  const shown = [];
  for (let run = 1; run <= 4; run++) {
    shown.push(maybeStarNudge({ logger, stream: TTY, env: QUIET_ENV, stateDir: dir, exitCode: 0 }));
  }
  assert.deepEqual(shown, [false, false, true, false]);
  assert.equal(logger.events.length, 1);
  assert.deepEqual({ level: logger.events[0].level, event: logger.events[0].event }, { level: 'info', event: 'cli.star_nudge' });
  assert.equal(logger.events[0].message, formatStarNudge());
  assert.ok(logger.events[0].message.includes(STAR_URL));
  assert.ok(logger.events[0].message.includes(STAR_COMMAND));
  assert.match(logger.events[0].message, /star-nudge: false/, 'the line says how to silence it');
  assert.doesNotMatch(logger.events[0].message, /\n/, 'one line');
});

test('CLI hook neither counts nor prints when the session is not eligible', (t) => {
  const cases = {
    'stderr is piped': { stream: { isTTY: false } },
    'stream missing': { stream: null },
    '--quiet': { quiet: true },
    'run ended with a non-zero exit code': { exitCode: 4 },
    'string exit code': { exitCode: '3' },
    'config opt-out': { config: { 'star-nudge': false } },
    'env opt-out': { env: { PATINA_NO_STAR_NUDGE: '1' } },
    CI: { env: { CI: '1' } },
  };
  for (const [name, overrides] of Object.entries(cases)) {
    const dir = stateDir(t);
    const logger = collectLogger();
    for (let run = 1; run <= 5; run++) {
      const printed = maybeStarNudge({ logger, stream: TTY, env: QUIET_ENV, stateDir: dir, exitCode: 0, ...overrides });
      assert.equal(printed, false, name);
    }
    assert.equal(logger.events.length, 0, name);
    assert.equal(existsSync(dir), false, `${name}: an ineligible run must not create state`);
  }
});

test('CLI hook survives a throwing logger and a throwing clock', (t) => {
  const dir = stateDir(t);
  const angry = { info() { throw new Error('logger down'); } };
  for (let run = 1; run <= 3; run++) {
    assert.doesNotThrow(() => maybeStarNudge({ logger: angry, stream: TTY, env: QUIET_ENV, stateDir: dir, exitCode: 0 }));
  }
  const other = stateDir(t);
  const brokenClock = () => { throw new Error('no clock'); };
  for (let run = 1; run <= 3; run++) {
    assert.equal(maybeStarNudge({ logger: collectLogger(), stream: TTY, env: QUIET_ENV, stateDir: other, exitCode: 0, now: brokenClock }), false);
  }
});

test('skill hook reports the notice value on the same schedule and honors opt-outs', (t) => {
  const dir = stateDir(t);
  const notices = [];
  for (let run = 1; run <= 21; run++) notices.push(skillStarNotice({ config: {}, env: QUIET_ENV, stateDir: dir }));
  assert.deepEqual(notices.map((n, i) => (n ? i + 1 : null)).filter(Boolean), [...STAR_NUDGE_AT]);
  assert.ok(notices.every((n) => n === null || n === 'star'));

  const silent = stateDir(t);
  for (let run = 1; run <= 5; run++) {
    assert.equal(skillStarNotice({ config: { 'star-nudge': false }, env: QUIET_ENV, stateDir: silent }), null);
    assert.equal(skillStarNotice({ config: {}, env: { CI: 'true' }, stateDir: silent }), null);
    assert.equal(skillStarNotice({ config: {}, env: QUIET_ENV, stateDir: undefined }), null);
  }
  assert.equal(existsSync(silent), false);
});

test('CLI and skill share one counter', (t) => {
  const dir = stateDir(t);
  const logger = collectLogger();
  assert.equal(maybeStarNudge({ logger, stream: TTY, env: QUIET_ENV, stateDir: dir, exitCode: 0 }), false);
  assert.equal(skillStarNotice({ env: QUIET_ENV, stateDir: dir }), null);
  assert.equal(maybeStarNudge({ logger, stream: TTY, env: QUIET_ENV, stateDir: dir, exitCode: 0 }), true, '3rd success overall');
  assert.equal(skillStarNotice({ env: QUIET_ENV, stateDir: dir }), null);
});

// Drives the real CLI entry: runDefault -> offline score -> reminder. No LLM.
test('runDefault prints the reminder after the 3rd successful terminal run, on stderr only', async (t) => {
  const dir = stateDir(t);
  const work = mkdtempSync(join(tmpdir(), 'patina-star-run-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const draft = join(work, 'draft.md');
  writeFileSync(draft, 'The meeting moved to Thursday. Bring the signed form.\n\nParking is behind the annex.\n');

  const saved = { env: { ...process.env }, isTTY: process.stderr.isTTY, exitCode: process.exitCode, log: console.log };
  t.after(() => {
    process.env = saved.env;
    process.stderr.isTTY = saved.isTTY;
    process.exitCode = saved.exitCode;
    console.log = saved.log;
  });
  process.env.PATINA_STATE_DIR = dir;
  delete process.env.CI;
  delete process.env.PATINA_NO_STAR_NUDGE;
  process.exitCode = 0;
  const stdout = [];
  console.log = (...args) => stdout.push(args.join(' '));

  const run = async (extra = []) => {
    const logger = collectLogger();
    await runDefault(parseArgs(['--score', '--offline', '--lang', 'en', ...extra, draft]), logger);
    return logger.events.filter((e) => e.event === 'cli.star_nudge');
  };

  process.stderr.isTTY = false;
  assert.equal((await run()).length, 0, 'a piped run is not counted');
  assert.equal(existsSync(dir), false);

  process.stderr.isTTY = true;
  assert.equal((await run()).length, 0);
  assert.equal((await run(['--quiet'])).length, 0, '--quiet is not counted');
  assert.equal((await run()).length, 0);
  const third = await run();
  assert.equal(third.length, 1, 'the 3rd eligible success shows the line');
  assert.equal(third[0].message, formatStarNudge());
  assert.equal((await run()).length, 0);
  assert.ok(stdout.length > 0 && stdout.every((line) => !line.includes(STAR_URL)), 'stdout stays the score output');
});

test('runDefault does not count a run that throws', async (t) => {
  const dir = stateDir(t);
  const saved = { env: { ...process.env }, isTTY: process.stderr.isTTY };
  t.after(() => { process.env = saved.env; process.stderr.isTTY = saved.isTTY; });
  process.env.PATINA_STATE_DIR = dir;
  delete process.env.CI;
  process.stderr.isTTY = true;
  await assert.rejects(runDefault(parseArgs(['--score', '--offline', join(dir, 'missing.md')]), collectLogger()));
  assert.equal(existsSync(join(dir, 'star-nudge.json')), false);
});
