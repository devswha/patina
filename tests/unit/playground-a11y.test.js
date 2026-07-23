// Static a11y invariants for the playground web surface (no DOM library, no
// new dependencies): these assert that the markup/CSS/controller keep the
// accessibility contract added in the frontend audit — labeled primary inputs,
// a live-region chat thread, alert-role error notes, keyboard-visible focus,
// and a closed mobile sidebar that leaves the tab order.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'playground', 'index.html'), 'utf8');
const css = readFileSync(join(root, 'playground', 'chatgpt.css'), 'utf8');
const js = readFileSync(join(root, 'playground', 'chatgpt.js'), 'utf8');

/** Extract the full opening tag that carries the given id. */
function openingTag(source, id) {
  const m = source.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(m, `expected an element with id="${id}"`);
  return m[0];
}

test('primary textareas carry aria-labels (hero + composer)', () => {
  assert.match(openingTag(html, 'hero-input'), /aria-label="/);
  assert.match(openingTag(html, 'input'), /aria-label="/);
});
test('Pro license entry is private and its controls have accessible names', () => {
  const licenseInput = openingTag(html, 'license-key');
  assert.match(licenseInput, /type="password"/);
  assert.match(licenseInput, /autocomplete="off"/);
  assert.match(licenseInput, /aria-label="[^"]+"/);

  const proControls = html.match(/<div[^>]*id="pro-row"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(proControls, 'expected the Pro license control row');
  assert.match(proControls[0], /<label\b[\s\S]*id="license-key"/);
  for (const [id, name] of [['license-sign-in', 'Sign in'], ['license-sign-out', 'Sign out']]) {
    const control = openingTag(html, id);
    assert.match(control, /type="button"/);
    assert.match(proControls[0], new RegExp(`<button[^>]*id="${id}"[^>]*>${name}</button>`));
  }
});

test('chat thread is an announced live region', () => {
  const thread = openingTag(html, 'thread');
  assert.match(thread, /role="log"/);
  assert.match(thread, /aria-live="polite"/);
  assert.match(thread, /aria-relevant="additions text"/);
  assert.match(thread, /aria-busy="false"/);
});

test('sidebar toggle exposes expanded state and its target', () => {
  const toggle = openingTag(html, 'toggle-sidebar');
  assert.match(toggle, /aria-controls="sidebar"/);
  assert.match(toggle, /aria-expanded="false"/);
});

test('inline preflight error containers are alert-roled', () => {
  for (const id of ['hero-error', 'composer-error', 'key-error']) {
    assert.match(openingTag(html, id), /role="alert"/, `${id} must have role="alert"`);
  }
});

test('every keyboard-interactive control has a :focus-visible style', () => {
  const selectors = [
    '.nav__links a:focus-visible',
    '.btn:focus-visible',
    '.suggest__pill:focus-visible',
    '.editor__tab:focus-visible',
    '.editor__btn:focus-visible',
    '.xcard__replay:focus-visible',
    '.xcard__try:focus-visible',
    '.cta__btn:focus-visible',
    '.newchat:focus-visible',
    '.histitem:focus-visible',
    '.iconbtn:focus-visible',
    '.prompt__send:focus-visible',
    '.composer__send:focus-visible',
  ];
  for (const sel of selectors) {
    assert.ok(css.includes(sel), `chatgpt.css must style ${sel}`);
  }
  // The shared ring must actually draw something.
  const block = css.slice(css.indexOf('.nav__links a:focus-visible'));
  assert.match(block, /outline:\s*2px solid/);
});

test('closed mobile sidebar leaves the tab order (visibility: hidden)', () => {
  const rule = css.match(/\.chat:not\(\.sidebar-open\) \.sidebar \{[^}]*\}/);
  assert.ok(rule, 'expected a closed-sidebar rule in the mobile media query');
  assert.match(rule[0], /visibility:\s*hidden/);
});

test('controller syncs the document language on locale change', () => {
  assert.match(js, /document\.documentElement\.lang = lang/);
});

test('controller toggles thread aria-busy around streaming', () => {
  assert.match(js, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(js, /setAttribute\('aria-busy', 'false'\)/);
});

test('error notes are announced via role=alert', () => {
  assert.match(js, /setAttribute\('role', 'alert'\)/);
});

test('sidebar toggle keeps aria-expanded in sync', () => {
  assert.match(js, /setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(js, /setAttribute\('aria-expanded', 'false'\)/);
});

test('localized copy never flows through innerHTML (clear-only usage allowed)', () => {
  const assignments = js.match(/\.innerHTML\s*=\s*[^;]+/g) || [];
  for (const a of assignments) {
    assert.match(a, /\.innerHTML\s*=\s*''/, `unexpected non-empty innerHTML assignment: ${a}`);
  }
});

test('every root-absolute asset reference resolves inside the served static root (playground/)', () => {
  // vercel.json serves ONLY playground/ as the static output, so a reference
  // like /assets/brand/patina-mark.svg 404s in production unless the file
  // exists under playground/. The top-left brand mark and the favicon shipped
  // broken exactly this way (repo-root assets/ is not deployed).
  const refs = new Set();
  for (const source of [html, js]) {
    for (const m of source.matchAll(/["'`(](\/assets\/[A-Za-z0-9_./-]+)["'`)]/g)) refs.add(m[1]);
  }
  assert.ok(refs.size > 0, 'expected at least one /assets/ reference to guard');
  for (const ref of refs) {
    assert.ok(
      existsSync(join(root, 'playground', ...ref.split('/').filter(Boolean))),
      `${ref} is referenced by the playground but missing under playground/ (would 404 on the live deploy)`,
    );
  }
});
