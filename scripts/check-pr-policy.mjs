#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TEMPLATE_PATH = '.github/PULL_REQUEST_TEMPLATE.md';
const GH_JSON_FIELDS = [
  'number',
  'title',
  'body',
  'baseRefName',
  'headRefName',
  'additions',
  'deletions',
  'changedFiles',
  'files',
  'labels',
].join(',');

export const PR_POLICY = Object.freeze({
  mode: 'warning',
  targetMinLines: 200,
  targetMaxLines: 400,
  reviewWarningLines: 600,
  reviewWarningFiles: 15,
});

const DIFF_STATUSES = new Set(['added', 'modified', 'deleted', 'copied', 'changed']);
const RENAME_STATUSES = new Set(['renamed', 'rename']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function finiteCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function positivePrId(value) {
  const text = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error('--pr requires a positive integer PR number');
  }
  return text;
}

function normalizeRef(value) {
  return typeof value === 'string' ? value.replace(/^refs\/heads\//, '').trim() : '';
}

function normalizeSection(value) {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/\s+#*$/, '')
    .trim()
    .toLowerCase();
}

/**
 * Parse level-two headings from a PR template or body.
 * Fenced code blocks are ignored so examples cannot satisfy a required section.
 *
 * @param {string} markdown
 * @returns {string[]} Unique section titles in source order.
 */
export function parsePrSections(markdown) {
  if (typeof markdown !== 'string') return [];
  const sections = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = line.match(/^\s{0,3}##(?!#)\s+(.+?)\s*$/);
    if (!heading) continue;
    const title = heading[1].replace(/\s+#+\s*$/, '').trim();
    if (title && !sections.some((section) => normalizeSection(section) === normalizeSection(title))) {
      sections.push(title);
    }
  }
  return sections;
}

/**
 * Return whether a path must remain reviewable even when marked generated.
 * Product Markdown and handwritten fixtures are deliberately protected from
 * generated-file exclusions.
 *
 * @param {string} path
 * @param {object} file
 * @returns {boolean}
 */
export function isProtectedReviewablePath(path, file = {}) {
  const normalized = String(path).replace(/\\/g, '/').toLowerCase();
  return file.handwritten === true || file.product === true ||
    /\.(?:md|mdx)$/.test(normalized) ||
    /(?:^|\/)(?:test|tests|fixture|fixtures|example|examples)(?:\/|$)/.test(normalized);
}

function generatorProvenance(file) {
  const candidate = firstDefined(
    file.generatorProvenance,
    file.generator_provenance,
    file.generatedBy,
    file.provenance,
    file.generator,
  );
  if (typeof candidate === 'string' && candidate.trim()) {
    return { approved: file.generatorApproved === true, descriptor: candidate.trim() };
  }
  return asObject(candidate);
}

function hasGeneratorDescriptor(provenance) {
  if (!provenance) return false;
  if (typeof provenance === 'string') return Boolean(provenance.trim());
  return [
    provenance.name,
    provenance.id,
    provenance.generator,
    provenance.tool,
    provenance.command,
    provenance.path,
    provenance.script,
    provenance.descriptor,
  ].some((value) => typeof value === 'string' && value.trim());
}

function hasApprovedGeneratorProvenance(file) {
  const provenance = generatorProvenance(file);
  if (!provenance) return false;
  const approved = provenance.approved === true || file.generatorApproved === true;
  return approved && hasGeneratorDescriptor(provenance);
}

function hasAnyGeneratorProvenance(file) {
  return firstDefined(
    file.generatorProvenance,
    file.generator_provenance,
    file.generatedBy,
    file.provenance,
    file.generator,
    file.generatorApproved,
  ) !== undefined;
}

function metadataFlag(value) {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function metadataCompleteFlag(value) {
  return value === false || (typeof value === 'string' && value.toLowerCase() === 'false');
}

function metadataBooleanKnown(value) {
  return value === undefined || value === true || value === false ||
    (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase()));
}

function inspectPagination(source, filesValue) {
  const reasons = [];
  const candidates = [
    ['truncated', source.truncated],
    ['filesTruncated', source.filesTruncated],
    ['fileMetadataTruncated', source.fileMetadataTruncated],
    ['incomplete', source.incomplete],
    ['partial', source.partial],
    ['metadata.truncated', asObject(source.metadata)?.truncated],
    ['metadata.incomplete', asObject(source.metadata)?.incomplete],
    ['files.truncated', asObject(filesValue)?.truncated],
    ['files.incomplete', asObject(filesValue)?.incomplete],
  ];
  for (const [label, value] of candidates) {
    if (metadataFlag(value)) reasons.push(`${label} metadata is truncated or incomplete`);
    else if (!metadataBooleanKnown(value)) reasons.push(`${label} metadata is unknown`);
  }

  const pageInfos = [
    ['pagination', source.pagination],
    ['pageInfo', source.pageInfo],
    ['files.pageInfo', asObject(filesValue)?.pageInfo],
  ];
  for (const [label, value] of pageInfos) {
    if (value === undefined) continue;
    if (!value || typeof value !== 'object') {
      reasons.push(`${label} metadata is unknown`);
      continue;
    }
    const hasNext = firstDefined(value.hasNextPage, value.has_next_page, value.nextPage, value.next_page);
    if (metadataFlag(hasNext)) reasons.push(`${label} has another page`);
    else if (!metadataCompleteFlag(hasNext)) reasons.push(`${label} metadata is incomplete`);
  }
  for (const [label, value] of [['hasNextPage', source.hasNextPage], ['has_next_page', source.has_next_page]]) {
    if (metadataFlag(value)) reasons.push('file metadata has another page');
    else if (!metadataBooleanKnown(value)) reasons.push(`${label} metadata is unknown`);
  }
  return reasons;
}

function readTemplate(repoRoot, templatePath, templateText) {
  if (templateText !== undefined) {
    return typeof templateText === 'string'
      ? { text: templateText, error: null }
      : { text: '', error: 'PR template text must be a string' };
  }
  const path = resolve(repoRoot, templatePath);
  if (!existsSync(path)) return { text: '', error: `PR template is missing: ${templatePath}` };
  try {
    return { text: readFileSync(path, 'utf8'), error: null };
  } catch (error) {
    return { text: '', error: `PR template could not be read: ${error.message}` };
  }
}

function normalizeInput(input) {
  const wrapper = asObject(input);
  const source = asObject(wrapper?.pullRequest) || wrapper;
  const nestedBase = asObject(source?.base);
  const nestedHead = asObject(source?.head);
  const filesValue = source?.files;
  let files = filesValue;
  let filePageInfo = null;
  if (asObject(filesValue)) {
    files = filesValue.nodes;
    filePageInfo = filesValue.pageInfo;
  }
  return {
    source,
    body: source?.body,
    baseRefName: firstDefined(source?.baseRefName, source?.base_ref_name, nestedBase?.ref),
    headRefName: firstDefined(source?.headRefName, source?.head_ref_name, nestedHead?.ref),
    additions: firstDefined(source?.additions, source?.stats?.additions),
    deletions: firstDefined(source?.deletions, source?.stats?.deletions),
    changedFiles: firstDefined(source?.changedFiles, source?.changed_files),
    files,
    filePageInfo,
    pagination: inspectPagination(source || {}, filesValue),
    labels: source?.labels,
    number: source?.number,
  };
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => {
    if (typeof label === 'string') return label;
    return asObject(label)?.name;
  }).filter((label) => typeof label === 'string');
}

function normalizedPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
  return path;
}

function fileRecord(file, index, errors) {
  const object = asObject(file);
  if (!object) {
    errors.push(`file ${index + 1} metadata is missing or malformed`);
    return {
      path: null,
      status: null,
      additions: 0,
      deletions: 0,
      rawLines: 0,
      reviewableLines: 0,
      excluded: false,
      protected: false,
    };
  }

  let fileValid = true;
  const invalid = (message) => {
    fileValid = false;
    errors.push(message);
  };
  const path = normalizedPath(firstDefined(object.path, object.filename));
  if (!path) invalid(`file ${index + 1} path metadata is missing or unsafe`);

  const statusValue = firstDefined(object.status, object.changeType);
  const status = typeof statusValue === 'string' ? statusValue.toLowerCase() : null;
  if (!status) invalid(`file ${index + 1} status metadata is missing`);
  else if (RENAME_STATUSES.has(status) || object.previousFilename || object.previous_filename || object.oldPath || object.old_path) {
    invalid(`file ${index + 1} rename metadata is unsupported`);
  } else if (!DIFF_STATUSES.has(status)) {
    invalid(`file ${index + 1} status is unknown: ${status}`);
  }

  const additions = finiteCount(firstDefined(object.additions, object.addedLines, object.added_lines));
  const deletions = finiteCount(firstDefined(object.deletions, object.deletedLines, object.deleted_lines));
  if (additions === null) invalid(`file ${index + 1} additions metadata is missing or invalid`);
  if (deletions === null) invalid(`file ${index + 1} deletions metadata is missing or invalid`);
  const safeAdditions = additions ?? 0;
  const safeDeletions = deletions ?? 0;

  let generated = object.generated;
  if (generated !== undefined && typeof generated !== 'boolean') {
    invalid(`file ${index + 1} generated metadata is unknown`);
    generated = false;
  }
  for (const field of ['handwritten', 'product']) {
    if (object[field] !== undefined && typeof object[field] !== 'boolean') {
      invalid(`file ${index + 1} ${field} metadata is unknown`);
    }
  }
  const protectedPath = path ? isProtectedReviewablePath(path, object) : false;
  let excluded = false;
  let exclusionReason = null;
  if (generated === true) {
    if (!hasApprovedGeneratorProvenance(object)) {
      invalid(`file ${index + 1} generated exclusion lacks approved generator provenance`);
    } else if (fileValid && !protectedPath) {
      excluded = true;
      exclusionReason = 'approved-generator-provenance';
    } else if (!fileValid) {
      exclusionReason = 'invalid-file-metadata';
    } else {
      exclusionReason = 'protected-product-or-handwritten-file';
    }
  } else if (hasAnyGeneratorProvenance(object)) {
    invalid(`file ${index + 1} generator provenance is not attached to generated=true`);
  }

  return {
    path,
    status,
    additions: safeAdditions,
    deletions: safeDeletions,
    rawLines: safeAdditions + safeDeletions,
    reviewableLines: excluded ? 0 : safeAdditions + safeDeletions,
    excluded,
    exclusionReason,
    protected: protectedPath,
    generated: generated === true,
  };
}

function isDocumentationPath(path) {
  return typeof path === 'string' && /\.(?:md|mdx|rst|txt)$/i.test(path);
}

function isProductMarkdownPath(path, file = {}) {
  if (file.product === true || file.handwritten === true) return true;
  if (typeof path !== 'string' || !/\.(?:md|mdx)$/i.test(path)) return false;
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (normalized.startsWith('.github/')) return false;
  return !normalized.includes('/') ||
    /^(?:docs|patterns|lexicon|personas|document-types|assets|integrations|playground|examples|tests?)\//.test(normalized);
}

/**
 * Evaluate one PR payload without network access.
 *
 * The payload shape is the object returned by `gh pr view --json` (or an
 * equivalent fixture). Missing, unknown, renamed, paginated, and truncated
 * file metadata produces an invalid report. Invalid reports remain warnings
 * under this pilot and are never classified as docs-only.
 *
 * @param {object} pullRequest
 * @param {{repoRoot?: string, templatePath?: string, templateText?: string}} [options]
 * @returns {object} Warning-mode policy report.
 */
export function collectPrPolicyReport(pullRequest, {
  repoRoot = REPO_ROOT,
  templatePath = DEFAULT_TEMPLATE_PATH,
  templateText,
} = {}) {
  const input = normalizeInput(pullRequest);
  const errors = [];
  const warnings = [];
  const rawAdditions = finiteCount(input.additions);
  const rawDeletions = finiteCount(input.deletions);
  if (rawAdditions === null) errors.push('PR additions metadata is missing or invalid');
  if (rawDeletions === null) errors.push('PR deletions metadata is missing or invalid');

  const baseRefName = normalizeRef(input.baseRefName);
  const headRefName = normalizeRef(input.headRefName);
  if (!baseRefName) errors.push('PR base branch metadata is missing');
  if (!headRefName) errors.push('PR head branch metadata is missing');
  const releaseAggregation = baseRefName === 'main' && headRefName === 'dev';

  if (typeof input.body !== 'string') errors.push('PR body metadata is missing');
  const template = readTemplate(repoRoot, templatePath, templateText);
  if (template.error) errors.push(template.error);
  const requiredSections = parsePrSections(template.text);
  if (!requiredSections.length && !template.error) errors.push('PR template has no required sections');
  const bodySections = parsePrSections(typeof input.body === 'string' ? input.body : '');
  const bodySectionKeys = new Set(bodySections.map(normalizeSection));
  const missingSections = requiredSections.filter((section) => !bodySectionKeys.has(normalizeSection(section)));
  for (const section of missingSections) errors.push(`PR body is missing required section: ${section}`);

  const fileMetadataErrors = [];
  const filesPresent = Array.isArray(input.files);
  if (!filesPresent) {
    fileMetadataErrors.push('PR file metadata is missing or malformed');
  }
  if (input.pagination.length) fileMetadataErrors.push(...input.pagination);

  const changedFiles = finiteCount(input.changedFiles);
  if (changedFiles === null) fileMetadataErrors.push('PR changedFiles metadata is missing or invalid');
  if (filesPresent && changedFiles !== null && changedFiles !== input.files.length) {
    fileMetadataErrors.push(`PR changedFiles (${changedFiles}) does not match file metadata (${input.files.length})`);
  }

  const files = filesPresent
    ? input.files.map((file, index) => fileRecord(file, index, fileMetadataErrors))
    : [];
  errors.push(...fileMetadataErrors);
  const fileAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const fileDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  let fileMetadataComplete = filesPresent &&
    input.pagination.length === 0 &&
    changedFiles !== null &&
    changedFiles === files.length &&
    fileMetadataErrors.length === 0;
  if (rawAdditions !== null && rawAdditions !== fileAdditions) {
    errors.push(`PR additions (${rawAdditions}) do not match file metadata (${fileAdditions})`);
    fileMetadataComplete = false;
  }
  if (rawDeletions !== null && rawDeletions !== fileDeletions) {
    errors.push(`PR deletions (${rawDeletions}) do not match file metadata (${fileDeletions})`);
    fileMetadataComplete = false;
  }

  // Once any report error exists, do not let a partial file list or a
  // malformed body influence exclusion accounting. The inconclusive report
  // remains fail-closed: every listed file is reviewable and no generated
  // output is silently removed from the review budget.
  if (errors.length) {
    for (const file of files) {
      if (!file.excluded) continue;
      file.excluded = false;
      file.reviewableLines = file.rawLines;
      file.exclusionReason = 'inconclusive-report';
    }
  }
  const listedReviewableAdditions = files.reduce((sum, file) => sum + (file.excluded ? 0 : file.additions), 0);
  const listedReviewableDeletions = files.reduce((sum, file) => sum + (file.excluded ? 0 : file.deletions), 0);
  const allListedAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const allListedDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const rawLines = rawAdditions !== null && rawDeletions !== null
    ? rawAdditions + rawDeletions
    : null;
  const knownFileCounts = [
    changedFiles,
    filesPresent ? files.length : null,
  ].filter((value) => value !== null);
  const conservativeFileCount = knownFileCounts.length ? Math.max(...knownFileCounts) : null;
  const rawFileCount = conservativeFileCount;
  const reviewableAdditions = fileMetadataComplete
    ? listedReviewableAdditions
    : rawAdditions !== null
      ? Math.max(rawAdditions, allListedAdditions)
      : null;
  const reviewableDeletions = fileMetadataComplete
    ? listedReviewableDeletions
    : rawDeletions !== null
      ? Math.max(rawDeletions, allListedDeletions)
      : null;
  const reviewableLines = reviewableAdditions !== null && reviewableDeletions !== null
    ? reviewableAdditions + reviewableDeletions
    : null;
  const reviewableFiles = fileMetadataComplete
    ? files.filter((file) => !file.excluded).length
    : conservativeFileCount;

  const labels = normalizeLabels(input.labels);
  const sizeExceptionRequested = labels.some((label) => /size-exception/i.test(label)) ||
    (typeof input.body === 'string' && /\bsize-exception\b/i.test(input.body));
  const sizeWarnings = [];
  const knownReviewableLines = reviewableLines ?? [
    reviewableAdditions,
    reviewableDeletions,
  ].filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const reviewableLineText = reviewableLines === null
    ? `at least ${knownReviewableLines} known`
    : `${reviewableLines}`;
  if (!releaseAggregation) {
    if (reviewableLines !== null && reviewableLines < PR_POLICY.targetMinLines) {
      sizeWarnings.push(`Reviewable diff is below the ${PR_POLICY.targetMinLines}-${PR_POLICY.targetMaxLines}-line target (${reviewableLines} lines).`);
    }
    if (knownReviewableLines > PR_POLICY.targetMaxLines) {
      sizeWarnings.push(`Reviewable diff is above the ${PR_POLICY.targetMinLines}-${PR_POLICY.targetMaxLines}-line target (${reviewableLineText} lines).`);
    }
    if (knownReviewableLines > PR_POLICY.reviewWarningLines) {
      sizeWarnings.push(`Reviewable diff exceeds the ${PR_POLICY.reviewWarningLines}-line review warning threshold (${reviewableLineText} lines).`);
    }
    if (reviewableFiles !== null && reviewableFiles > PR_POLICY.reviewWarningFiles) {
      sizeWarnings.push(`Reviewable file count exceeds the ${PR_POLICY.reviewWarningFiles}-file review warning threshold (${reviewableFiles} files).`);
    }
  }
  warnings.push(...sizeWarnings);
  if (sizeExceptionRequested && !releaseAggregation) {
    warnings.push('A size-exception label or request does not waive PR size warnings without recorded owner approval.');
  }

  const valid = errors.length === 0;
  const docsOnly = valid && !releaseAggregation && files.length > 0 && files.every((file) => (
    isDocumentationPath(file.path) &&
    !isProductMarkdownPath(file.path, file) &&
    !file.protected
  ));
  const classification = !valid
    ? 'inconclusive'
    : releaseAggregation
      ? 'release-aggregation'
      : docsOnly
        ? 'docs-only'
        : 'standard';

  return {
    valid,
    invalid: !valid,
    status: valid ? 'ok' : 'inconclusive',
    ok: valid,
    warningMode: true,
    enforcement: PR_POLICY.mode,
    classification,
    docsOnly,
    releaseAggregation,
    isReleaseAggregation: releaseAggregation,
    baseRefName,
    headRefName,
    number: input.number ?? null,
    requiredSections,
    bodySections,
    missingSections,
    errors,
    warnings,
    raw: {
      additions: rawAdditions,
      deletions: rawDeletions,
      lines: rawLines,
      files: rawFileCount,
    },
    reviewable: {
      additions: reviewableAdditions,
      deletions: reviewableDeletions,
      lines: reviewableLines,
      files: reviewableFiles,
    },
    fileMetadataComplete,
    incompleteFileMetadata: !fileMetadataComplete,
    rawAdditions,
    rawDeletions,
    rawLines,
    reviewableAdditions,
    reviewableDeletions,
    reviewableLines,
    reviewableFiles,
    changedFiles: rawFileCount,
    excludedFiles: files.filter((file) => file.excluded).map((file) => file.path),
    files,
    sizeException: {
      requested: sizeExceptionRequested,
      waived: false,
      reason: releaseAggregation ? 'release-aggregation' : 'no-automatic-waiver',
    },
  };
}

/**
 * Fetch a PR through the read-only GitHub CLI view command.
 *
 * @param {{pr: string|number, repoRoot?: string, repo?: string, spawn?: Function}} options
 * @returns {object}
 */
export function fetchPullRequest({ pr, repoRoot = REPO_ROOT, repo, spawn = spawnSync } = {}) {
  const prId = positivePrId(pr);
  const args = ['pr', 'view', prId, '--json', GH_JSON_FIELDS];
  if (repo) args.push('--repo', repo);
  const result = spawn('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result?.error) throw new Error(`gh pr view could not start: ${result.error.message}`, { cause: result.error });
  if ((result?.status ?? 1) !== 0) {
    throw new Error(`gh pr view failed${result?.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`gh pr view returned malformed JSON: ${error.message}`, { cause: error });
  }
}

function readFixture(path) {
  let text;
  try {
    text = readFileSync(resolve(path), 'utf8');
  } catch (error) {
    throw new Error(`PR fixture could not be read: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`PR fixture is malformed JSON: ${error.message}`, { cause: error });
  }
}

/**
 * Parse the small offline/online CLI surface.
 *
 * @param {string[]} argv
 * @returns {object}
 */
export function parsePrPolicyArgs(argv = process.argv.slice(2)) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--pr' || arg === '--input' || arg === '--fixture' || arg === '--repo' || arg === '--repo-root' || arg === '--template') {
      const value = argv[index + 1];
      if (!value || (arg !== '--pr' && value.startsWith('--'))) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--pr') options.pr = positivePrId(value);
      else if (arg === '--repo') options.repo = value;
      else if (arg === '--repo-root') options.repoRoot = value;
      else if (arg === '--template') options.templatePath = value;
      else options.inputPath = value;
    } else if (arg.startsWith('--pr=')) {
      options.pr = positivePrId(arg.slice('--pr='.length));
    } else if (arg.startsWith('--input=') || arg.startsWith('--fixture=')) {
      options.inputPath = arg.slice(arg.indexOf('=') + 1);
    } else if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length);
    } else if (arg.startsWith('--repo-root=')) {
      options.repoRoot = arg.slice('--repo-root='.length);
    } else if (arg.startsWith('--template=')) {
      options.templatePath = arg.slice('--template='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error('only one offline PR fixture may be provided');
  if (positional.length === 1) options.inputPath = positional[0];
  if (options.pr !== undefined) options.pr = positivePrId(options.pr);
  if (options.pr !== undefined && options.inputPath !== undefined) {
    throw new Error('--pr and --input/--fixture cannot be used together');
  }
  return options;
}

function formatReport(report) {
  const lines = [
    `PR policy (${report.enforcement} mode): ${report.classification}`,
    `Raw diff: ${report.raw.lines} lines (${report.raw.additions}+${report.raw.deletions}), ${report.raw.files} file(s)`,
    `Reviewable diff: ${report.reviewable.lines} lines (${report.reviewable.additions}+${report.reviewable.deletions}), ${report.reviewable.files} file(s)`,
  ];
  if (report.excludedFiles.length) lines.push(`Approved generated exclusions: ${report.excludedFiles.join(', ')}`);
  if (report.errors.length) {
    lines.push('Invalid metadata:');
    lines.push(...report.errors.map((error) => `- ${error}`));
  }
  if (report.warnings.length) {
    lines.push('Warnings:');
    lines.push(...report.warnings.map((warning) => `- ${warning}`));
  }
  if (!report.errors.length && !report.warnings.length) lines.push('No policy warnings.');
  return `${lines.join('\n')}\n`;
}

/**
 * Run the warning-only policy check. Size-policy warnings return exit code 0;
 * invalid/inconclusive metadata reports return 1 and are never silently
 * converted to successful docs-only results. Input/CLI/gh failures also return
 * 1.
 *
 * @param {{pullRequest?: object, prData?: object, inputPath?: string, pr?: string|number, repoRoot?: string, repo?: string, spawn?: Function, json?: boolean, stdout?: object}} [options]
 * @returns {number}
 */
export function runPrPolicyCheck(options = {}) {
  let pullRequest = options.pullRequest ?? options.prData;
  if (pullRequest === undefined && options.inputPath !== undefined) pullRequest = readFixture(options.inputPath);
  if (pullRequest === undefined && options.pr !== undefined) {
    pullRequest = fetchPullRequest(options);
  }
  if (pullRequest === undefined) {
    throw new Error('provide --pr <number> or an offline --input <fixture.json>');
  }
  const report = collectPrPolicyReport(pullRequest, options);
  const stdout = options.stdout ?? process.stdout;
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  return report.valid ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePrPolicyArgs();
    if (options.help) {
      process.stdout.write('Usage: node scripts/check-pr-policy.mjs --input <fixture.json> [--json]\n       node scripts/check-pr-policy.mjs --pr <number> [--repo <owner/name>] [--json]\n');
      process.exitCode = 0;
    } else {
      process.exitCode = runPrPolicyCheck(options);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
