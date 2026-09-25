#!/usr/bin/env node
// Local Linux study supervisor: durable PID/start-time and terminal receipts.
// A receipt alone never proves a job is live; status verifies /proc identity.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '../..');
const ENTRIES = new Set(['tests/quality/live-scorer-benchmark.mjs', 'scripts/research/model-rewrite-benchmark.mjs']);

export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (['Z', 'X'].includes(fields[0])) return null;
    return { pid, startTime: fields[19], bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
  } catch { return null; }
}

export function isSameProcess(identity) {
  const current = processIdentity(identity?.pid);
  return Boolean(current && current.startTime === identity.startTime && current.bootId === identity.bootId);
}

function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function jobStatus(directory) {
  const path = resolve(directory, 'job.json');
  const job = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const lockPath = resolve(directory, 'start.lock');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (isSameProcess(lock.identity)) return { ...(job?.identity?.pid === lock.identity.pid ? job : {}), identity: lock.identity, state: 'running' };
    if (lock.identity?.pid !== job?.identity?.pid) return { state: 'stopped-without-receipt', identity: lock.identity };
  }
  if (!job) return { state: 'missing' };
  return { ...job, state: isSameProcess(job.identity) ? 'running' : job.endedAt ? job.state : 'stopped-without-receipt' };
}

async function worker(directory, entry, args) {
  const path = resolve(directory, 'job.json');
  const job = { schemaVersion: 1, state: 'running', identity: processIdentity(process.pid), entry, args, startedAt: new Date().toISOString() };
  writeJson(resolve(directory, 'start.lock'), { identity: job.identity });
  writeJson(path, job);
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_API_KEY;
  const child = spawn(process.execPath, [resolve(ROOT, entry), ...args], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const terminal = await new Promise((done) => {
    child.once('error', () => done({ exitCode: null, signal: null, state: 'spawn-failed' }));
    child.once('exit', (code, signal) => done({ exitCode: code, signal, state: code === 0 ? 'completed' : 'failed' }));
  });
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  writeJson(path, { ...job, ...terminal, endedAt: new Date().toISOString() });
  const lock = resolve(directory, 'start.lock');
  try { if (JSON.parse(readFileSync(lock, 'utf8')).identity?.pid === process.pid) unlinkSync(lock); } catch { /* A missing lock does not change the terminal receipt. */ }
  process.exitCode = terminal.exitCode === 0 ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, directoryArg, entry, ...args] = argv;
  if (!directoryArg || !['start', 'status', 'worker'].includes(command)) throw new Error('Usage: study-job <start|status> JOB_DIR [ENTRY ARGS...]');
  const directory = resolve(directoryArg);
  if (command === 'status') { console.log(JSON.stringify(jobStatus(directory))); return; }
  if (process.platform !== 'linux') throw new Error('Study supervisor requires Linux process identity verification');
  if (!ENTRIES.has(entry)) throw new Error('Entry is not an approved study runner');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (command === 'worker') return worker(directory, entry, args);
  const previous = jobStatus(directory);
  if (previous.state === 'running') { console.log(JSON.stringify(previous)); return; }
  const lock = resolve(directory, 'start.lock');
  if (existsSync(lock)) {
    const owner = JSON.parse(readFileSync(lock, 'utf8'));
    if (!owner.identity || isSameProcess(owner.identity)) throw new Error('Study launch already in progress');
    unlinkSync(lock); // The recorded owner is authoritatively absent.
  }
  const lockFd = openSync(lock, 'wx', 0o600);
  writeFileSync(lockFd, JSON.stringify({ identity: processIdentity(process.pid) }));
  closeSync(lockFd);
  const fd = openSync(resolve(directory, 'worker.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [SELF, 'worker', directory, entry, ...args], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] });
    await new Promise((ready, reject) => { child.once('spawn', ready); child.once('error', reject); });
    writeJson(lock, { identity: processIdentity(child.pid) });
    child.unref();
    console.log(JSON.stringify({ state: 'started', pid: child.pid, directory }));
  } finally { closeSync(fd); }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
