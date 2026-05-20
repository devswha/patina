import js from '@eslint/js';

const nodeGlobals = {
  AbortController: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  console: 'readonly',
  clearTimeout: 'readonly',
  fetch: 'readonly',
  globalThis: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
};

export default [
  {
    ignores: [
      '.git/**',
      '.omx/**',
      'node_modules/**',
      'docs/benchmarks/*.json',
      'tests/quality/results.json',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^patterns$', varsIgnorePattern: '^_' }],
    },
  },
];
