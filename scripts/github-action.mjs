#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import {
  formatMarkdownReport,
  parseBoolean,
  parseFileList,
  scoreFiles,
  summarizeRows,
} from './prose-score.mjs';

const COMMENT_MARKER = '<!-- patina-pr-score -->';

async function main() {
  const gate = numberInput('INPUT_GATE', 30, { max: 100 });
  const maxFiles = numberInput('INPUT_MAX_FILES', 50, { max: 1000, integer: true });
  const lang = process.env.INPUT_LANG || 'auto';
  const token = process.env.INPUT_TOKEN || process.env.GITHUB_TOKEN || '';
  const comment = parseBoolean(process.env.INPUT_COMMENT, true);
  const failOnGate = parseBoolean(process.env.INPUT_FAIL_ON_GATE, false);
  const explicitFiles = parseFileList(process.env.INPUT_FILES || '');
  const files = explicitFiles.length ? explicitFiles : await changedFilesFromContext({ token, maxFiles });

  const rows = scoreFiles(files, { gate, lang, maxFiles });
  const summary = summarizeRows(rows);
  const report = formatMarkdownReport(rows, { gate, title: 'Patina PR prose hotspot report' });
  const body = `${COMMENT_MARKER}\n${report}`;

  writeOutput('file-count', String(summary.fileCount));
  writeOutput('failed-count', String(summary.failedCount));
  writeOutput('max-score', summary.maxScore.toFixed(1));
  writeStepSummary(report);
  console.log(report);

  if (comment) {
    try {
      await upsertPullRequestComment({ token, body });
    } catch (error) {
      console.warn(`patina-action: could not write PR comment: ${error.message}`);
    }
  }

  if (failOnGate && summary.failedCount > 0) {
    console.error(`patina-action: ${summary.failedCount}/${summary.fileCount} file(s) exceeded gate ${gate}.`);
    process.exitCode = 1;
  }
}

function numberInput(name, defaultValue, { min = 0, max = 100, integer = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}, got ${raw}`);
  }
  return n;
}

async function changedFilesFromContext({ token, maxFiles }) {
  const event = readEvent();
  const pull = event.pull_request;
  if (!pull || !token) return [];
  const fullName = event.repository?.full_name;
  if (!fullName) return [];
  const [owner, repo] = fullName.split('/');
  const files = [];
  for (let page = 1; files.length < maxFiles; page++) {
    const batch = await githubJson({
      token,
      path: `/repos/${owner}/${repo}/pulls/${pull.number}/files?per_page=100&page=${page}`,
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    files.push(...batch.map((item) => item.filename).filter(Boolean));
    if (batch.length < 100) break;
  }
  return files.slice(0, maxFiles);
}

function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function upsertPullRequestComment({ token, body }) {
  const event = readEvent();
  const pull = event.pull_request;
  const fullName = event.repository?.full_name;
  if (!token || !pull || !fullName) return;
  const [owner, repo] = fullName.split('/');
  const comments = await githubJson({
    token,
    path: `/repos/${owner}/${repo}/issues/${pull.number}/comments?per_page=100`,
  });
  const existing = Array.isArray(comments)
    ? comments.find((comment) => String(comment.body || '').includes(COMMENT_MARKER))
    : null;
  if (existing) {
    await githubJson({
      token,
      method: 'PATCH',
      path: `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      body: { body },
    });
  } else {
    await githubJson({
      token,
      method: 'POST',
      path: `/repos/${owner}/${repo}/issues/${pull.number}/comments`,
      body: { body },
    });
  }
}

async function githubJson({ token, method = 'GET', path, body }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'patina-action',
      'x-github-api-version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function writeOutput(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  appendFileSync(path, `${name}=${value}\n`);
}

function writeStepSummary(report) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${report}\n`);
}

main().catch((error) => {
  console.error(`patina-action: ${error.message}`);
  process.exit(2);
});
