#!/usr/bin/env node
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import jsdoc2md from 'jsdoc-to-markdown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(REPO_ROOT, 'docs/API.md');

const SOURCES = [
  'src/api.js',
  'src/auth.js',
  'src/cli.js',
  'src/cli/run.js',
  'src/config.js',
  'src/errors.js',
  'src/loader.js',
  'src/logger.js',
  'src/ouroboros.js',
  'src/output.js',
  'src/prompt-builder.js',
  'src/providers.js',
  'src/scoring.js',
  'src/security.js',
];

const header = `# API Reference

This file is generated from JSDoc comments in \`src/*.js\`.
Run \`npm run docs:api\` after changing public exports or their JSDoc.
`;

const scoringExample = `## Worked example: programmatic scoring

The package currently publishes these modules for CLI reuse, but deep imports should be treated as unstable until an explicit \`exports\` map is introduced.

Use \`scoreText\` directly when you want patina's score envelope inside another Node.js tool. This example injects a mock \`callLLM\` so the snippet is deterministic; replace it with the default HTTP caller plus provider credentials in production.

\`\`\`js
import { getRepoRoot, loadConfig } from 'patina-cli/src/config.js';
import { loadPatterns } from 'patina-cli/src/loader.js';
import { scoreText } from 'patina-cli/src/scoring.js';

const config = loadConfig();
config.language = 'en';

const patterns = loadPatterns(getRepoRoot(), config.language);
const text = 'Coffee has emerged as a pivotal cultural phenomenon.';

const result = await scoreText({
  text,
  config,
  patterns,
  model: 'deterministic-example',
  callLLM: async () => JSON.stringify({
    categories: {
      content: { detected: 1, sum: 1, max: 18, score: 5.6, weighted: 1.7 },
    },
    overall: 24,
    interpretation: 'mostly human',
  }),
});

console.log(result.overall); // 24 unless deterministic shadow scoring reconciles upward
console.log(result.interpretation); // mostly human
\`\`\`
`;

const personaCliReference = `## Persona CLI commands

Personas are the reusable voice-composition unit. The YAML frontmatter is the
deterministic single source of truth; the Markdown body is docs-only and is
never sent to the model. Custom personas live in \`custom/personas/<lang>/\` and
shadow same-id built-ins under \`personas/<lang>/\`. Every write and edit passes
the persona safety gate (\`validatePersona\`), which clamps the MPS/fidelity
floors to their core minimum and rejects gate-weakening keys.

| Command | Description |
| --- | --- |
| \`patina persona new <id>\` | Author a custom persona (\`--from-sample <file>\`, \`--describe "<text>"\`, \`--template\`, or an interactive wizard). |
| \`patina persona list\` | List built-in and custom personas (\`--lang\`, \`--format json\`). |
| \`patina persona show <id>\` | Print a persona's normalized config — id, name, lang, depth, MPS/fidelity floors, active blocks, \`target_features\` keys, resolved path, and source. \`--json\` emits the normalized object. The docs-only body is never printed. |
| \`patina persona rm <id>\` | Remove a custom persona. Built-in library seeds and the \`preserve\` default are protected. Requires \`--force\` or an interactive y/N confirm; only files under \`custom/personas/<lang>/\` are ever deleted. |
| \`patina persona edit <id>\` | Copy-on-edit into \`custom/personas/<lang>/\`. Editing a built-in copies it into custom (a shadow), preserving the library. Re-derive the voice with \`--from-sample <file>\` / \`--describe "<text>"\`, or keep it and rename with \`--name "<new name>"\`. |

Common options: \`--lang <ko|en|zh|ja>\` (default \`ko\`), and \`--backend <name>\` for
sample/describe derivation.

\`\`\`bash
patina persona show natural-ko --json        # inspect a built-in persona
patina persona edit natural-ko --name "My KO" # shadow it into custom/personas/ko/
patina persona rm my-voice --lang ko          # remove a custom persona
\`\`\`
`;

// jsdoc (catharsis) can't parse the TS-flavored JSDoc tsc relies on, so route
// parsing through a comment-only compat plugin (see lib/jsdoc-ts-compat.cjs).
const jsdocConfDir = await mkdtemp(join(tmpdir(), 'patina-jsdoc-'));
const jsdocConfPath = join(jsdocConfDir, 'conf.json');
await writeFile(jsdocConfPath, JSON.stringify({
  plugins: [resolve(__dirname, 'lib/jsdoc-ts-compat.cjs')],
}));
let data;
try {
  data = await jsdoc2md.getTemplateData({
    files: SOURCES.map((source) => resolve(REPO_ROOT, source)),
    configure: jsdocConfPath,
  });
} finally {
  await rm(jsdocConfDir, { recursive: true, force: true });
}
const generated = await jsdoc2md.render({
  data: data.filter((doclet) => doclet.kind !== 'class' && doclet.kind !== 'constructor'),
});

const output = [
  header.trimEnd(),
  scoringExample.trimEnd(),
  personaCliReference.trimEnd(),
  '## Generated reference\n\n<!-- Generated by scripts/generate-api-docs.mjs using jsdoc-to-markdown. Do not edit by hand. -->',
  renderClasses(data).trimEnd(),
  generated.trimEnd(),
].filter(Boolean).join('\n\n') + '\n';

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, stripTrailingWhitespace(output));
console.log(`Wrote ${OUT_PATH}`);

function stripTrailingWhitespace(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n');
}

function renderClasses(doclets) {
  const classes = doclets
    .filter((doclet) => doclet.kind === 'class')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (classes.length === 0) return '';
  const constructors = new Map(
    doclets
      .filter((doclet) => doclet.kind === 'constructor')
      .map((doclet) => [doclet.longname, doclet])
  );
  return [
    '## Classes',
    ...classes.map((klass) => renderClass(klass, constructors.get(klass.longname))),
  ].join('\n\n');
}

function renderClass(klass, ctor) {
  const lines = [
    `<a name="${klass.longname}"></a>`,
    `### ${klass.name}`,
    '',
    klass.description || '',
    '',
    '**Kind**: global class',
  ];
  if (ctor?.params?.length) {
    lines.push('', '#### Constructor parameters', '', renderParamTable(ctor.params));
  }
  if (ctor?.examples?.length) {
    lines.push('', '**Example**', '', '```js', ...ctor.examples, '```');
  }
  return lines.join('\n').trimEnd();
}

function renderParamTable(params) {
  return [
    '| Param | Type | Description |',
    '| --- | --- | --- |',
    ...params.map((param) => `| ${formatParamName(param)} | ${formatType(param.type?.names)} | ${param.description || ''} |`),
  ].join('\n');
}

function formatParamName(param) {
  const name = param.name || '';
  if (!param.optional) return name;
  const fallback = param.defaultvalue === undefined ? '' : `=${param.defaultvalue}`;
  return `[${name}${fallback}]`;
}

function formatType(names = []) {
  return names.map((name) => `\`${name}\``).join(' \\| ') || '';
}
