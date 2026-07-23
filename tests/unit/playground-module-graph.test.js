// The production static root is playground/ ONLY (vercel.json
// outputDirectory), so every URL the browser's ES-module graph requests must
// resolve to a file under playground/. This broke live once: chatgpt.js and
// rewrite-client.js import '../src/web-rewrite-contract.js', which the browser
// normalizes to /src/web-rewrite-contract.js — a 404 under the playground-only
// static root. The failed import killed the whole module graph, so no JS ran
// and the send button stayed permanently disabled. curl-based checks never
// caught it because they fetch files without executing the import graph.
//
// Fix shape: a checked-in, byte-identical artifact at
// playground/src/web-rewrite-contract.js. The contract stays single-sourced in
// src/ (Lane A); the artifact is a deploy copy, and the parity test below
// fails CI the moment they diverge.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const playground = join(root, 'playground');

test('the served contract artifact is byte-identical to src/web-rewrite-contract.js', () => {
  const source = readFileSync(join(root, 'src', 'web-rewrite-contract.js'), 'utf8');
  const artifact = readFileSync(join(playground, 'src', 'web-rewrite-contract.js'), 'utf8');
  assert.equal(artifact, source, 'playground/src/web-rewrite-contract.js must be regenerated (cp src/web-rewrite-contract.js playground/src/) after editing the contract');
});

test('every static ESM import in the playground resolves inside the served static root', () => {
  const files = readdirSync(playground).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'expected playground JS modules');
  for (const name of files) {
    const source = readFileSync(join(playground, name), 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      // Reproduce browser URL resolution exactly: the importing module is
      // served at /<name> off the playground web root, and the URL API clamps
      // any ../ at the root the same way a browser does (so
      // '../src/web-rewrite-contract.js' from /chatgpt.js requests
      // /src/web-rewrite-contract.js).
      const { pathname } = new URL(spec, `https://static.invalid/${name}`);
      const served = join(playground, ...pathname.split('/').filter(Boolean));
      assert.ok(
        existsSync(served),
        `${name} imports ${spec} -> ${pathname}, which is not under playground/ and 404s in production (a failed import kills the whole module graph)`
      );
    }
  }
});
