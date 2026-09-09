// Execute the actual controller with a small DOM adapter and injected transport.
// This checks control/state/payload wiring; layout/browser QA is a separate gate.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import vm from 'node:vm';
import * as client from '../../playground/rewrite-client.js';
import * as preferences from '../../playground/preferences.js';
import * as copy from '../../playground/experience-copy.js';
import * as contract from '../../src/web-rewrite-contract.js';
import * as protection from '../../playground/protected-input.js';
import { createEditReview } from '../../playground/edit-review.js';

// Isolated UI fixtures: native curated copy is validated separately after integration.
const EXAMPLES = ['ko', 'en', 'zh', 'ja'].flatMap((lang) => Array.from({ length: 3 }, (_, i) => ({
  id: `${lang}-fixture-${i}`, lang, kind: 'illustrative', label: `${lang} fixture ${i + 1}`,
  before: `${lang} fixture source ${i + 1}: 70%`, after: `${lang} fixture result ${i + 1}: 70%`, caption: `${lang} fixture caption ${i + 1}`,
})));

const html = readFileSync(new URL('../../playground/index.html', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../playground/chatgpt.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;$/gm, '');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._value = undefined;
    this._text = '';
    this.scrollHeight = 24;
    this.classList = {
      contains: (value) => this.className.split(' ').includes(value),
      add: (...values) => { this.className = [...new Set([...this.className.split(' '), ...values])].join(' ').trim(); },
      remove: (...values) => { this.className = this.className.split(' ').filter((v) => !values.includes(v)).join(' '); },
      toggle: (value, force) => {
        const enabled = force ?? !this.classList.contains(value);
        this.classList[enabled ? 'add' : 'remove'](value); return enabled;
      },
    };
  }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = value; }
  get id() { return this.attributes.id; }
  set id(value) { this.attributes.id = value; }
  get options() { return this.children.filter((c) => c.tagName === 'option'); }
  get value() {
    if (this.tagName === 'select') return this.options.find((o) => o.value === this._value)?.value ?? (this._value === undefined ? this.options[0]?.value || '' : '');
    return this._value ?? this.attributes.value ?? '';
  }
  set value(value) { this._value = value; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  set innerHTML(value) { assert.equal(value, ''); this.replaceChildren(); this._value = undefined; }
  get isConnected() { return this.tagName === 'document' || Boolean(this.parentElement?.isConnected); }
  get disabled() { return 'disabled' in this.attributes; }
  set disabled(value) { this.toggleAttribute('disabled', value); }
  get hidden() { return 'hidden' in this.attributes; }
  set hidden(value) { this.toggleAttribute('hidden', value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }
  toggleAttribute(name, force) { if (force) this.attributes[name] = ''; else delete this.attributes[name]; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach((c) => this.appendChild(c)); }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = []; this._text = ''; this.append(...children);
  }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  removeEventListener(name, listener) { this.listeners[name] = (this.listeners[name] || []).filter((fn) => fn !== listener); }
  emit(name, extra = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    if (name === 'click' && this.disabled) return event;
    for (let node = this; node; node = node.parentElement) {
      for (const fn of node.listeners[name] || []) fn(event);
    }
    return event;
  }
  focus() { this.focused = true; }
  click() { this.emit('click'); }
  matches(selector) {
    const attr = selector.match(/\[([^=\]]+)="([^"]*)"\]/);
    if (attr && (attr[1] === 'value' ? this.value : this.getAttribute(attr[1])) !== attr[2]) return false;
    if (selector.endsWith(':last-child') && this.parentElement?.children.at(-1) !== this) return false;
    const simple = selector.replace(/\[.*?\]|:last-child/g, '');
    if (simple.startsWith('#')) return this.id === simple.slice(1);
    if (simple.startsWith('.')) return this.classList.contains(simple.slice(1));
    return this.tagName === simple;
  }
  querySelectorAll(selector) {
    const parts = selector.split(',').map((s) => s.trim().split(/\s+/));
    const descendants = (node) => node.children.flatMap((c) => [c, ...descendants(c)]);
    return descendants(this).filter((node) => parts.some((path) => {
      if (!node.matches(path.at(-1))) return false;
      let parent = node.parentElement;
      for (let i = path.length - 2; i >= 0; i--) {
        while (parent && !parent.matches(path[i])) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function documentFixture() {
  const document = new Element('document');
  const stack = [document];
  for (const match of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<\/?[a-z][^>]*>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1)._text += token; continue; }
    const tag = token.match(/^<([a-z0-9]+)/)[1];
    const node = new Element(tag);
    for (const attr of token.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(node);
    if (!['meta', 'link', 'img', 'input', 'br', 'hr'].includes(tag) && !token.endsWith('/>')) stack.push(node);
  }
  document.documentElement = document.querySelector('html');
  document.defaultView = { crypto: webcrypto };
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (text) => { const node = new Element('#text'); node.textContent = text; return node; };
  return document;
}

function app({ response, storage = new Map(), languages = [], language, search = '', funnel } = {}) {
  const document = documentFixture();
  const calls = [];
  const reviews = [];
  const context = vm.createContext({
    ...contract, ...client, ...preferences, ...copy, ...protection, EXAMPLES,
    navigator: { languages, language },
    location: { search },
    patinaFunnelReady: funnel,
    createEditReview: (options) => {
      const pending = createEditReview({ ...options, document });
      reviews.push(pending);
      return pending;
    },
    launchConfig: { schemaVersion: 1, enabled: false },
    document,
    Option: class extends Element { constructor(label, value) { super('option'); this.textContent = label; this.value = value; } },
    AbortController, URL, URLSearchParams: globalThis.URLSearchParams, setTimeout, clearTimeout,
    requestAnimationFrame() {}, addEventListener() {}, scrollTo() {},
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    streamRewrite: async (options) => {
      calls.push(options);
      if (response) return response(options);
      options.onStart?.({ type: 'start' });
      const frame = { type: 'done', rewrite: 'Accepted 70%', mps: 70, fidelity: 70 };
      options.onDone(frame);
      return { ok: true, finalFrame: frame };
    },
    // These injected wrappers resolve this fixture's storage, not Node global storage.
    readPresets: () => preferences.readPresets(() => context.localStorage),
    writePresets: (items) => preferences.writePresets(items, () => context.localStorage),
  });
  vm.runInContext(controller + '\nglobalThis.ui = { state, submit, activeConvo, newConvo, selectConvo, readControls, failureMessage, addRecovery };', context);
  return {
    document, calls, storage, context, ui: context.ui, get: (id) => document.querySelector(`#${id}`),
    async settle() { await nextTurn(); await Promise.all(reviews); await nextTurn(); },
  };
}
function change(app, id, value) { const node = app.get(id); node.value = value; node.emit('change'); }
function controls(app) { return JSON.parse(JSON.stringify(app.ui.readControls())); }
function type(app, id, value) { const node = app.get(id); node.value = value; node.emit('input'); }
function snapshot(convo) {
  return JSON.parse(JSON.stringify({
    messages: convo.messages, original: convo.thread.original, turns: convo.thread.turns,
    currentDraft: convo.thread.currentDraft, settings: convo.thread.preferences,
    protectedInput: convo.protectedInput, reviewPending: convo.reviewPending,
  }));
}

test('Home then hero submit starts a first turn, retains selected settings, and leaves the prior conversation intact', async () => {
  const a = app();
  change(a, 'lang', 'ko'); change(a, 'document-type', 'namuwiki');
  change(a, 'persona', 'soft-professional'); change(a, 'register', 'professional');
  a.get('pro-existing').emit('click');
  a.get('license-key').value = 'private-license'; a.get('license-sign-in').emit('click');
  await a.ui.submit('첫 원문 70%');
  const first = a.ui.activeConvo(), before = snapshot(first), settings = controls(a);
  assert.equal(a.ui.state.convos.length, 1, 'initial hero reuses the empty conversation');
  a.get('home-link').emit('click');
  type(a, 'hero-input', 'A fresh source 70%');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.at(-1).body.mode, 'first');
  assert.equal(a.calls.at(-1).body.text, 'A fresh source 70%');
  assert.equal('original' in a.calls.at(-1).body, false);
  assert.equal('history' in a.calls.at(-1).body, false);
  assert.equal(a.calls.at(-1).body.lang, 'ko', 'an explicitly selected language survives new source detection');
  assert.equal(a.calls.at(-1).body.documentType, 'namuwiki');
  assert.equal(a.calls.at(-1).body.persona, 'soft-professional');
  assert.equal(a.calls.at(-1).body.register, 'professional');
  assert.equal(a.calls.at(-1).authorization, 'Bearer private-license');
  assert.deepEqual(controls(a), settings);
  const second = a.ui.activeConvo();
  assert.notEqual(second, first);
  assert.equal(a.ui.state.convos.length, 2);
  assert.equal(second.thread.original, 'A fresh source 70%');
  assert.deepEqual(snapshot(first), before);
  type(a, 'input', 'Make it shorter');
  a.get('composer').emit('submit');
  await a.settle();
  assert.equal(a.calls.at(-1).body.mode, 'refine');
  assert.equal(a.calls.at(-1).body.original, 'A fresh source 70%');
  a.get('history').children[1].emit('click');
  assert.equal(a.ui.activeConvo(), first);
  assert.deepEqual(snapshot(first), before);
});

test('fresh hero input drops old protected anchors and can detect a new language', async () => {
  const a = app();
  type(a, 'protected-text', 'ACME');
  await a.ui.submit('ACME source 70%');
  const first = a.ui.activeConvo(), before = snapshot(first);
  // Even an invalid constraint edited after completion belongs to that old source.
  type(a, 'protected-text', 'Missing old phrase');
  const edited = snapshot(first);
  a.get('home-link').emit('click');
  type(a, 'hero-input', '한국어 새 원문 70%');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 2, 'old protected-input validation must not block a fresh hero source');
  assert.equal(a.calls[1].body.mode, 'first');
  assert.equal(a.calls[1].body.lang, 'ko');
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), []);
  assert.equal(a.get('protected-text').value, '');
  assert.equal(a.ui.activeConvo().thread.languageExplicit, false);
  assert.deepEqual(snapshot(first), edited);
  assert.equal(before.original, 'ACME source 70%');
  a.ui.selectConvo(first);
  assert.equal(a.get('protected-text').value, 'Missing old phrase');
});

test('fresh hero protection survives the first submit without editing the prior conversation', async () => {
  const a = app();
  type(a, 'protected-text', 'Old product');
  await a.ui.submit('Old product costs $20.');
  const first = a.ui.activeConvo(), before = snapshot(first);
  a.get('home-link').emit('click');
  type(a, 'hero-input', 'New product costs $10.');
  type(a, 'protected-text', 'New product');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].body.mode, 'first');
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), [{ start: 0, end: 11 }]);
  assert.equal(a.ui.activeConvo().protectedInput, 'New product');
  assert.equal(a.get('protected-text').value, 'New product');
  assert.deepEqual(snapshot(first), before);
  a.get('home-link').emit('click');
  assert.equal(a.get('protected-text').value, '', 'a submitted draft must not leak its constraints into the next source');
  a.ui.selectConvo(first);
  assert.equal(a.get('protected-text').value, 'Old product');
  assert.deepEqual(snapshot(first), before);
});

test('unmatched fresh hero protection fails the first preflight and remains editable for retry', async () => {
  const a = app();
  type(a, 'protected-text', 'Old product');
  await a.ui.submit('Old product costs $20.');
  const first = a.ui.activeConvo(), before = snapshot(first);
  a.get('home-link').emit('click');
  type(a, 'hero-input', 'New product costs $10.');
  type(a, 'protected-text', 'Missing product');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 1, 'an unmatched fresh constraint must block the request');
  assert.equal(a.get('hero-error').hidden, false);
  assert.equal(a.get('hero-error').textContent, protection.PROTECTED_INPUT_COPY.en.invalid);
  assert.equal(a.get('hero-input').value, 'New product costs $10.');
  assert.equal(a.get('protected-text').value, 'Missing product');
  assert.equal(a.get('protected-text').disabled, false);
  assert.equal(a.get('app').getAttribute('data-view'), 'landing');
  assert.deepEqual(snapshot(first), before);
  const fresh = a.ui.activeConvo();
  assert.notEqual(fresh, first);
  assert.equal(fresh.messages.length, 0);
  type(a, 'protected-text', 'New product');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 2);
  assert.equal(a.ui.activeConvo(), fresh);
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), [{ start: 0, end: 11 }]);
  a.ui.selectConvo(first);
  assert.equal(a.get('protected-text').value, 'Old product');
  assert.deepEqual(snapshot(first), before);
});

test('pending hero protection stays separate across repeated Home clicks and visits to the old conversation', async () => {
  const a = app();
  const empty = a.ui.activeConvo();
  a.get('new-chat').emit('click');
  type(a, 'protected-text', 'Old product');
  await a.ui.submit('Old product costs $20.');
  const first = a.ui.activeConvo(), before = snapshot(first);
  a.get('home-link').emit('click');
  assert.equal(a.get('protected-text').value, '', 'old constraints must not appear as fresh draft constraints');
  type(a, 'protected-text', 'New product');
  type(a, 'hero-input', 'New product costs $10.');
  assert.deepEqual(snapshot(first), before, 'typing a fresh constraint must not mutate the old conversation');
  a.get('home-link').emit('click');
  assert.equal(a.get('protected-text').value, 'New product');
  a.ui.selectConvo(first);
  assert.equal(a.get('protected-text').value, 'Old product');
  a.ui.selectConvo(empty);
  assert.equal(a.get('protected-text').value, '');
  a.get('home-link').emit('click');
  assert.equal(a.get('protected-text').value, 'New product');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), [{ start: 0, end: 11 }]);
  assert.equal(empty.protectedInput, '', 'visiting an unrelated empty conversation cannot claim the hero draft');
  assert.deepEqual(snapshot(first), before);
});

test('hero preflight failures keep the new draft and reuse its empty conversation on retry', async () => {
  const a = app();
  change(a, 'document-type', 'email'); change(a, 'register', 'casual');
  await a.ui.submit('Earlier source');
  const first = a.ui.activeConvo(), before = snapshot(first);
  a.get('home-link').emit('click');
  type(a, 'hero-input', '  \n ');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.ui.state.convos.length, 1, 'whitespace must not create an empty history entry');
  const oversized = 'x'.repeat(contract.TIER_LIMITS.free.maxChars + 1);
  type(a, 'hero-input', oversized);
  a.get('hero-form').emit('submit');
  await a.settle();
  const fresh = a.ui.activeConvo();
  assert.notEqual(fresh, first, 'preflight runs against an independent new conversation');
  assert.equal(a.get('hero-error').hidden, false);
  assert.equal(a.get('hero-input').value, oversized);
  assert.equal(a.get('app').getAttribute('data-view'), 'landing');
  assert.equal(fresh.messages.length, 0);
  assert.equal(fresh.thread.original, undefined);
  assert.deepEqual(controls(a), before.settings);
  change(a, 'tier', 'byok');
  type(a, 'hero-input', 'New product 70%');
  type(a, 'protected-text', 'New product');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.get('key-error').hidden, false, 'fresh protection validates against the fresh source, before missing-key recovery');
  assert.equal(a.get('hero-input').value, 'New product 70%');
  assert.equal(a.ui.activeConvo(), fresh);
  assert.equal(a.ui.state.convos.length, 2, 'failed retries reuse the empty conversation');
  assert.equal(a.calls.length, 1);
  type(a, 'api-key', 'private-provider-key');
  const provider = a.get('provider').value, model = a.get('model').value;
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].body.mode, 'first');
  assert.equal(a.calls[1].body.provider, provider);
  assert.equal(a.calls[1].body.model, model);
  assert.equal(a.calls[1].body.apiKey, 'private-provider-key');
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), [{ start: 0, end: 11 }]);
  assert.equal(a.ui.activeConvo(), fresh);
  assert.equal(a.get('hero-input').value, '');
  assert.deepEqual(snapshot(first), before);
});

test('a pending edit review blocks its composer but does not block a fresh hero conversation', async () => {
  const hash = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
  const original = 'A cat sat.', rewrite = 'The cat slept.';
  const a = app({ response(options) {
    const frame = { type: 'done', rewrite, mps: 100, fidelity: 100 };
    if (options.body.text === original) frame.editReview = {
      schemaVersion: 1, offsetEncoding: 'utf-16', baseHash: hash(original), outputHash: hash(rewrite),
      edits: [{ start: 0, end: 1, replacement: 'The' }, { start: 6, end: 9, replacement: 'slept' }],
    };
    options.onDone(frame);
    return { ok: true, finalFrame: frame };
  } });
  type(a, 'protected-text', 'cat');
  await a.ui.submit(original);
  await a.settle();
  const first = a.ui.activeConvo();
  const checkbox = a.document.querySelector('.edit-review__checkbox');
  assert.ok(checkbox, 'the actual review component must be mounted');
  checkbox.checked = false; checkbox.emit('change');
  await a.settle();
  assert.equal(first.reviewPending, true);
  const before = snapshot(first);
  type(a, 'input', 'Shorten it');
  assert.equal(a.get('send').disabled, true);
  a.get('composer').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 1);
  a.get('home-link').emit('click');
  assert.equal(a.get('protected-text').disabled, false, 'the old pending review must not lock fresh constraints');
  type(a, 'hero-input', 'New product costs $10.');
  type(a, 'protected-text', 'New product');
  assert.deepEqual(snapshot(first), before);
  assert.equal(a.get('hero-send').disabled, false, 'pending review belongs only to its own composer');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].body.mode, 'first');
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), [{ start: 0, end: 11 }]);
  assert.notEqual(a.ui.activeConvo(), first);
  assert.deepEqual(snapshot(first), before);
  assert.equal(a.get('protected-text').disabled, false);
  // Detached review controls cannot change either conversation.
  checkbox.checked = true; checkbox.emit('change');
  await a.settle();
  assert.deepEqual(snapshot(first), before);
  a.ui.selectConvo(first);
  await a.settle();
  assert.equal(first.reviewPending, true);
  assert.equal(a.document.querySelector('.edit-review__checkbox').checked, false);
  assert.equal(a.get('protected-text').value, 'cat');
  assert.equal(a.get('protected-text').disabled, true);
  type(a, 'input', 'Still pending');
  assert.equal(a.get('send').disabled, true);
});

test('Home and hero Enter leave a running rewrite isolated until it completes', async () => {
  let finish;
  const a = app({ response: (options) => new Promise((resolve) => {
    finish = () => {
      const frame = { type: 'done', rewrite: 'Finished source', mps: 100, fidelity: 100 };
      options.onDone(frame); resolve({ ok: true, finalFrame: frame });
    };
  }) });
  type(a, 'protected-text', 'Running');
  const pending = a.ui.submit('Running source');
  const first = a.ui.activeConvo();
  try {
    a.get('home-link').emit('click');
    assert.equal(a.get('protected-text').disabled, true);
    // Even a forced input event on the disabled field cannot mutate either owner.
    type(a, 'protected-text', 'Blocked edit');
    type(a, 'hero-input', 'Next source');
    a.get('hero-input').emit('keydown', { key: 'Enter' });
    await a.ui.submit('Next source', 'hero');
    assert.equal(a.ui.state.busy, true);
    assert.equal(a.ui.activeConvo(), first);
    assert.equal(a.ui.state.convos.length, 1);
    assert.equal(a.calls.length, 1);
    assert.equal(a.calls[0].signal.aborted, false, 'Enter must not cancel a running attempt');
    assert.equal(first.protectedInput, 'Running');
    assert.equal(a.get('hero-input').value, 'Next source');
  } finally { finish(); await pending; }
  assert.equal(first.thread.original, 'Running source');
  assert.equal(a.ui.state.busy, false);
  assert.equal(a.get('protected-text').disabled, false);
  type(a, 'protected-text', 'Next');
  const freshPending = a.ui.submit(a.get('hero-input').value, 'hero');
  try {
    assert.equal(a.calls.length, 2);
    assert.equal(a.calls[1].body.mode, 'first');
    assert.deepEqual(JSON.parse(JSON.stringify(a.calls[1].body.protectedSpans)), [{ start: 0, end: 4 }]);
    assert.equal(first.protectedInput, 'Running');
    assert.notEqual(a.ui.activeConvo(), first);
  } finally { finish(); await freshPending; }
});

for (const [source, id] of [['hero', 'hero-input'], ['chat', 'input']]) {
  for (const [label, event] of [
    ['active composition', { key: 'Enter', isComposing: true, keyCode: 13 }],
    ['IME boundary keyCode', { key: 'Enter', isComposing: false, keyCode: 229 }],
    ['Shift+Enter', { key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }],
    ['ordinary character', { key: 'a', isComposing: false, keyCode: 65 }],
  ]) {
    test(`${source}: ${label} does not submit, prevent the input event, or clear draft text`, async () => {
      const a = app();
      if (source === 'chat') { await a.ui.submit('Original source'); }
      const before = snapshot(a.ui.activeConvo()), count = a.calls.length;
      type(a, id, '한글 中文 日本語');
      const dispatched = a.get(id).emit('keydown', event);
      await a.settle();
      assert.equal(a.calls.length, count);
      assert.equal(dispatched.defaultPrevented, false);
      assert.equal(a.get(id).value, '한글 中文 日本語');
      assert.deepEqual(snapshot(a.ui.activeConvo()), before);
      const enter = a.get(id).emit('keydown', { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 });
      await a.settle();
      assert.equal(enter.defaultPrevented, true);
      assert.equal(a.calls.length, count + 1, 'normal Enter still submits exactly once');
      assert.equal(a.calls.at(-1).body.mode, source === 'chat' ? 'refine' : 'first');
      assert.equal(a.calls.at(-1).body.text, '한글 中文 日本語');
      assert.equal(a.get(id).value, '');
    });
  }
}

test('verification credential recovery does not turn its selection into a composer rewrite', () => {
  const a = app();
  const body = a.document.createElement('div');
  a.ui.addRecovery(body, { convo: a.ui.activeConvo(), epoch: a.ui.state.sessionEpoch,
    clean: 'Selected draft must not be generated again.', reqBody: { mode: 'verify', tier: 'pro' } }, 'credentials');
  body.querySelector('.retrybtn').emit('click');
  assert.equal(a.get('input').value, '');
  assert.equal(a.calls.length, 0);
  assert.equal(a.get('license-key').focused, true);
  assert.equal(a.get('send').disabled, true);
});

for (const lang of contract.SUPPORTED_LANGS) {
  test(`${lang}: actual Pro controls apply a memory-only key, validate on first request and route existing buyers to it`, async () => {
    const a = app();
    change(a, 'lang', lang);
    a.get('pro-existing').emit('click');
    assert.equal(a.get('tier').value, 'pro');
    assert.equal(a.get('pro-row').hidden, false);
    assert.equal(a.get('license-key').focused, true);
    a.get('license-key').value = 'private-license';
    a.get('license-sign-in').emit('click');
    const t = copy.experienceCopy(lang);
    assert.equal(a.get('license-sign-in').textContent, t.signIn);
    assert.equal(a.get('license-status').textContent, t.licenseStates.pending);
    assert.equal(a.calls.length, 0, 'apply is not authentication');
    await a.ui.submit('A source 70%', 'hero');
    assert.equal(a.calls[0].body.lang, lang, 'an explicit language survives script detection');
    assert.equal(a.calls[0].authorization, 'Bearer private-license');
    assert.equal('license' in a.calls[0].body, false);
    assert.equal(a.get('license-status').textContent, t.licenseStates.validated);
    assert.equal(a.ui.activeConvo().thread.original, 'A source 70%', '70/70 is accepted');
    a.get('preset-name').value = 'Work';
    a.get('preset-save').emit('click');
    assert.doesNotMatch([...a.storage.values()].join(''), /private-license|A source|Accepted|history|authorization|apiKey/);
    assert.equal(a.get('pro-portal').hidden, true, 'unconfigured portal stays hidden');
    assert.equal(a.document.querySelector('.price__badge').textContent, t.proBadge);
    assert.equal(a.document.querySelectorAll('.price')[1].querySelector('.price__name').textContent, 'BYOK');
  });
}

test('actual A/B switches restore all controls and next payload; conflicting language selection is visibly rejected', async () => {
  const a = app();
  change(a, 'lang', 'ko'); change(a, 'document-type', 'namuwiki'); change(a, 'persona', 'soft-professional'); change(a, 'register', 'professional');
  await a.ui.submit('원문 70%');
  const first = a.ui.activeConvo();
  a.get('new-chat').emit('click');
  change(a, 'lang', 'ja'); change(a, 'document-type', 'email'); change(a, 'persona', 'natural-ja'); change(a, 'register', 'casual');
  await a.ui.submit('原文 70%');
  const second = a.ui.activeConvo();
  a.get('history').children[1].emit('click');
  assert.deepEqual(controls(a), { lang: 'ko', documentType: 'namuwiki', persona: 'soft-professional', register: 'professional' });
  await a.ui.submit('더 짧게', 'chat');
  assert.equal(a.calls.at(-1).body.original, '원문 70%');
  assert.equal(a.calls.at(-1).body.lang, 'ko');
  assert.equal(a.calls.at(-1).body.persona, 'soft-professional');
  change(a, 'lang', 'en');
  assert.equal(a.get('lang').value, 'ko');
  assert.equal(a.get('settings-status').textContent, copy.experienceCopy('ko').languageLocked);
  a.ui.selectConvo(second);
  assert.deepEqual(controls(a), { lang: 'ja', documentType: 'email', persona: 'natural-ja', register: 'casual' });
  change(a, 'register', '');
  await a.ui.submit('短く', 'chat');
  assert.equal('register' in a.calls.at(-1).body, false);
  assert.equal(a.calls.at(-1).body.original, '原文 70%');
  a.ui.selectConvo(first);
  assert.equal(a.get('register').value, 'professional');
});

test('actual presets apply/delete/restore safely and reject a conflicting language without partial updates', async () => {
  const a = app();
  change(a, 'lang', 'ko'); change(a, 'persona', 'soft-professional');
  a.get('preset-name').value = '한국어'; a.get('preset-save').emit('click');
  const storage = a.storage;
  change(a, 'lang', 'en'); change(a, 'document-type', 'email');
  await a.ui.submit('Source');
  const before = controls(a);
  a.get('preset-select').value = '한국어'; a.get('preset-select').emit('change'); a.get('preset-apply').emit('click');
  assert.deepEqual(controls(a), before);
  assert.equal(a.get('preset-status').textContent, copy.experienceCopy('en').languageLocked);
  a.get('new-chat').emit('click'); a.get('preset-apply').emit('click');
  assert.equal(controls(a).lang, 'ko');
  assert.equal(controls(a).persona, 'soft-professional');
  const reloaded = app({ storage });
  assert.equal(reloaded.get('preset-select').options[1].value, '한국어');
  assert.deepEqual(controls(reloaded), { lang: 'en', documentType: 'default', persona: '', register: '' });
  reloaded.get('preset-select').value = '한국어'; reloaded.get('preset-select').emit('change'); reloaded.get('preset-delete').emit('click');
  assert.equal(reloaded.get('preset-select').options.length, 1);
});

for (const [status, error, kind] of [
  [401, 'pro license required', 'AUTH_REQUIRED'], [403, 'license not entitled', 'AUTH_DENIED'],
  [429, 'monthly rewrite limit reached', 'QUOTA_MONTHLY_REQUESTS'],
  [429, 'monthly character limit reached', 'QUOTA_MONTHLY_CHARS'],
  [429, 'monthly processing attempt limit reached', 'QUOTA_MONTHLY_PROCESSING'],
  [429, 'undocumented limit', 'QUOTA_UNKNOWN'],
]) {
  for (const lang of contract.SUPPORTED_LANGS) {
    test(`${lang}: ${status} ${error} renders distinct recovery and never replays the failed request`, async () => {
      const a = app({ response: () => ({ ok: false, finalFrame: { status, error } }) });
      change(a, 'lang', lang); a.get('pro-existing').emit('click');
      a.get('license-key').value = 'private-license'; a.get('license-sign-in').emit('click');
      await a.ui.submit('Source');
      const K = client.REWRITE_ERROR_KINDS;
      const classified = client.classifyRewriteError({ status, error });
      assert.equal(classified, K[kind]);
      const message = a.document.querySelector('.error-note').textContent;
      const recovery = a.document.querySelector('.retrybtn');
      const t = copy.experienceCopy(lang);
      const localized = ({ AUTH_REQUIRED: 'authRequired', AUTH_DENIED: 'authDenied', QUOTA_MONTHLY_REQUESTS: 'monthlyRequests', QUOTA_MONTHLY_CHARS: 'monthlyChars', QUOTA_MONTHLY_PROCESSING: 'monthlyProcessing', QUOTA_UNKNOWN: 'quotaUnknown' })[kind];
      assert.equal(message, t[localized]);
      assert.equal(a.ui.activeConvo().thread.original, undefined);
      assert.notEqual(client.rewriteRecovery(classified), 'retry');
      recovery.emit('click');
      assert.equal(a.calls.length, 1);
      assert.equal(a.get('input').value, 'Source');
      if (status === 401 || status === 403) {
        assert.equal(a.ui.state.license, '');
        assert.equal(a.get('license-key').disabled, false);
        assert.equal(a.get('license-status').textContent, t.licenseStates.rejected);
        await a.ui.submit('Source', 'chat');
        assert.equal(a.calls.length, 1, 'missing key blocks another network request');
      }
    });
  }
}

test('below-floor output cannot commit even when the Pro license was accepted', async () => {
  const a = app({ response(options) {
    options.onStart();
    const frame = { type: 'done', rewrite: 'Unacceptable', mps: 69, fidelity: 100 };
    options.onDone(frame);
    return { ok: true, finalFrame: frame };
  } });
  a.get('pro-existing').emit('click');
  a.get('license-key').value = 'private-license'; a.get('license-sign-in').emit('click');
  await a.ui.submit('Source');
  assert.equal(a.ui.activeConvo().thread.original, undefined);
  assert.equal(a.ui.activeConvo().messages.filter((m) => m.role === 'assistant').length, 0);
  assert.equal(a.document.querySelector('.output-action'), null);
});

test('license status cannot report success on apply, network failure or infrastructure denial', () => {
  let status = copy.licenseStatusAfter('empty', 'apply');
  assert.equal(status, 'pending');
  status = copy.licenseStatusAfter(status, 'request');
  assert.equal(copy.licenseStatusAfter(status, 'end'), 'unconfirmed');
  assert.equal(copy.licenseStatusAfter(status, 'denied'), 'rejected');
  assert.equal(copy.licenseStatusAfter(status, 'accepted'), 'validated');
});

test('portal links require an explicit safe Polar customer portal; no checkout-derived URL', () => {
  for (const config of [null, {}, { checkoutOrigin: 'https://polar.sh', checkoutPath: '/checkout/test' },
    ...['https://evil.invalid/org/portal', 'javascript:alert(1)', 'https://polar.sh.evil.invalid/org/portal', 'https://user@polar.sh/org/portal', 'https://polar.sh/org/portal?key=secret', 'https://polar.sh/org/checkout'].map((portalUrl) => ({ portalUrl }))]) {
    assert.equal(copy.configuredPortalHref(config), '');
  }
  assert.equal(copy.configuredPortalHref({ portalUrl: 'https://polar.sh/configured-org/portal' }), 'https://polar.sh/configured-org/portal');
});


for (const [locale, lang] of [['ko-KR', 'ko'], ['en-US', 'en'], ['zh-Hant-TW', 'zh'], ['ja-JP', 'ja']]) {
  test(`${locale}: first screen is native and Free can send without setup`, async () => {
    const a = app({ languages: [locale] });
    assert.equal(a.get('lang').value, lang);
    assert.equal(a.document.documentElement.lang, lang);
    assert.equal(a.get('lang').getAttribute('aria-label'), copy.experienceCopy(lang).labels[0]);
    assert.equal(a.ui.activeConvo().thread.languageExplicit, false);
    assert.deepEqual(controls(a), { lang, documentType: 'default', persona: '', register: '' });
    assert.equal(a.get('tier').value, 'free');
    assert.equal(a.get('settings-panel').getAttribute('open'), null);
    assert.equal(a.get('settings-label').textContent, copy.onboardingCopy(lang).settings);
    assert.equal(a.get('hero-hint').textContent, copy.onboardingCopy(lang).heroHint);
    assert.equal(a.document.querySelector('.hero__sub').textContent, copy.onboardingCopy(lang).sub);
    assert.equal(a.get('suggest').children.length, 3);
    assert.equal(a.get('example-choice').options.length, 3);
    assert.equal(a.get('example-choice').value, `${lang}-fixture-0`);
    type(a, 'hero-input', 'Source 70%');
    assert.equal(a.get('hero-send').disabled, false);
    a.get('hero-form').emit('submit');
    await a.settle();
    assert.equal(a.calls.length, 1);
    assert.equal(a.calls[0].body.lang, 'en', 'the browser locale must not disable automatic source detection');
    assert.equal(a.calls[0].body.tier, 'free');
    assert.equal(a.calls[0].authorization, undefined);
    assert.equal(a.calls[0].body.apiKey, undefined);
  });
}

test('locale fallback uses browser preference order and an explicit selection survives source detection', async () => {
  const a = app({ languages: ['de-DE', 'ja-JP', 'ko-KR'] });
  assert.equal(a.get('lang').value, 'ja');
  change(a, 'lang', 'zh');
  assert.equal(a.document.documentElement.lang, 'zh');
  assert.equal(a.ui.activeConvo().thread.languageExplicit, true);
  await a.ui.submit('English source 70%');
  assert.equal(a.calls[0].body.lang, 'zh');
  change(a, 'lang', 'ko');
  assert.equal(a.get('lang').value, 'zh', 'an anchored conversation cannot change language');
  assert.equal(a.get('settings-status').textContent, copy.experienceCopy('zh').languageLocked);
  assert.equal(app({ languages: ['fr-FR'] }).get('lang').value, 'en');
});

test('a new hero draft can explicitly select a language without modifying the anchored chat', async () => {
  const a = app({ languages: ['ja-JP'] });
  await a.ui.submit('Original 70%');
  const first = a.ui.activeConvo(), original = snapshot(first);
  a.get('home-link').emit('click');
  type(a, 'hero-input', '新しい原文 70%');
  type(a, 'protected-text', '70%');
  change(a, 'lang', 'ja');
  assert.equal(a.get('hero-input').value, '新しい原文 70%');
  assert.equal(a.get('protected-text').value, '70%');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.at(-1).body.lang, 'ja');
  assert.equal(a.calls.at(-1).body.mode, 'first');
  assert.deepEqual(snapshot(first), original);
});

test('all four example tabs have keyboard selection and three independently selectable rows', () => {
  const a = app({ languages: ['ko-KR'] });
  const tabs = a.document.querySelectorAll('.editor__tab');
  assert.equal(tabs.length, 4);
  assert.deepEqual(tabs.map((tab) => tab.dataset.lang), ['ko', 'en', 'zh', 'ja']);
  for (const tab of tabs) {
    tab.emit('click');
    assert.equal(tab.getAttribute('aria-selected'), 'true');
    assert.equal(tab.getAttribute('tabindex'), '0');
    assert.equal(a.get('example-panel').getAttribute('aria-labelledby'), tab.id);
    assert.equal(a.document.querySelectorAll('.editor__tab').filter((t) => t.getAttribute('aria-selected') === 'true').length, 1);
    assert.equal(a.get('example-choice').options.length, 3);
    for (const row of EXAMPLES.filter((row) => row.lang === tab.dataset.lang)) {
      change(a, 'example-choice', row.id);
      assert.equal(a.document.querySelector('.editor__seg--before').textContent, row.before);
      assert.equal(a.document.querySelector('.editor__seg--after').textContent, row.after);
      assert.equal(a.document.querySelector('.editor__cap').textContent, row.caption);
    }
  }
  tabs[3].emit('keydown', { key: 'ArrowRight' });
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[0].focused, true);
  tabs[0].emit('keydown', { key: 'End' });
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');
  tabs[3].emit('keydown', { key: 'Home' });
  tabs[0].emit('keydown', { key: 'ArrowLeft' });
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');
  assert.equal(a.get('lang').value, 'ko', 'browsing example tabs is not a rewrite-language override');
  assert.equal(a.calls.length, 0, 'curated previews never pretend to run the API');
});

test('samples load the hero and native preview; using a foreign example keeps the prior conversation intact', async () => {
  const a = app({ languages: ['zh-CN'] });
  a.get('suggest').children[2].emit('click');
  assert.equal(a.get('hero-input').value, EXAMPLES.find((row) => row.id === 'zh-fixture-2').before);
  assert.equal(a.get('example-choice').value, 'zh-fixture-2');
  assert.equal(a.get('hero-send').disabled, false);
  assert.equal(a.calls.length, 0);
  await a.ui.submit('原来的文章 70%');
  const first = a.ui.activeConvo(), original = snapshot(first);
  a.get('home-link').emit('click');
  a.get('example-tab-ja').emit('click');
  change(a, 'example-choice', 'ja-fixture-1');
  a.document.querySelector('.xcard__try').emit('click');
  assert.equal(a.get('hero-input').value, EXAMPLES.find((row) => row.id === 'ja-fixture-1').before);
  assert.equal(a.get('lang').value, 'ja');
  assert.equal(a.get('example-choice').value, 'ja-fixture-1');
  assert.equal(a.get('protected-text').value, '');
  assert.deepEqual(snapshot(first), original);
  assert.equal(a.calls.length, 1, 'choosing an example only fills the prompt');
});

test('illustrative copy has no guessed scores while approved API scores stay visible', async () => {
  const a = app({ response: async (options) => {
    const frame = { type: 'done', rewrite: 'Accepted 70%', mps: 91, fidelity: 87 };
    options.onDone(frame); return { ok: true, finalFrame: frame };
  } });
  assert.equal(a.get('example-note').textContent, copy.onboardingCopy('en').illustrative);
  assert.doesNotMatch(a.get('example-cards').textContent, /MPS|Fidelity|verified live/i);
  await a.ui.submit('Source 70%');
  assert.match(a.get('thread').textContent, /MPS.*91/);
  assert.match(a.get('thread').textContent, /Fidelity.*87/);
  assert.equal(a.document.querySelector('.output-status').textContent, 'Approved — checks passed. Actions are enabled.');
});

// The status line is the only visible statement about whether a result passed the
// meaning gate, so its transitions are asserted as observable state, not as source shape.
function statusOf(a) {
  const node = a.document.querySelector('.output-status');
  return node && { text: node.textContent, state: node.dataset.outputStatus };
}

test('the approval status is silent in flight and states every terminal outcome', async () => {
  const t = { unapproved: 'Unapproved — checks have not passed. Actions are disabled.',
    approved: 'Approved — checks passed. Actions are enabled.' };

  // In flight: no claim either way, because the request has not produced a result.
  let release;
  const pending = app({ response: (options) => new Promise((resolve) => {
    options.onStart?.({ type: 'start' });
    options.onDelta?.('partial', 'partial');
    release = () => {
      const frame = { type: 'done', rewrite: 'Accepted 70%', mps: 91, fidelity: 87 };
      options.onDone(frame); resolve({ ok: true, finalFrame: frame });
    };
  }) });
  const streaming = pending.ui.submit('Source 70%');
  assert.deepEqual(statusOf(pending), { text: '', state: 'streaming' },
    'a running rewrite must not be announced as a failed check');
  assert.equal(pending.document.querySelector('.output-action'), null);
  release();
  await streaming;
  await pending.settle();
  assert.deepEqual(statusOf(pending), { text: t.approved, state: 'approved' });
  assert.ok(pending.document.querySelectorAll('.output-action').length > 0);

  // Below the meaning floor: rejected, announced, and no actions offered.
  const floor = app({ response: (options) => {
    options.onStart?.({ type: 'start' });
    const frame = { type: 'done', rewrite: 'Rejected', mps: 12, fidelity: 9 };
    options.onDone(frame); return { ok: true, finalFrame: frame };
  } });
  await floor.ui.submit('Source 70%');
  await floor.settle();
  assert.deepEqual(statusOf(floor), { text: t.unapproved, state: 'unapproved' });
  assert.equal(floor.document.querySelector('.output-action'), null);
  assert.equal(floor.ui.activeConvo().thread.original, undefined);

  // Transport failure: still a stated outcome, never a stranded empty line.
  const failed = app({ response: () => ({ ok: false, finalFrame: { status: 500, error: 'upstream failed' } }) });
  await failed.ui.submit('Source 70%');
  await failed.settle();
  assert.deepEqual(statusOf(failed), { text: t.unapproved, state: 'unapproved' });
  assert.equal(failed.document.querySelector('.output-action'), null);

  // Explicit Stop: the cancelled attempt reports unapproved rather than staying blank.
  const stopped = app({ response: (options) => new Promise(() => { options.onStart?.({ type: 'start' }); }) });
  const running = stopped.ui.submit('Source 70%');
  assert.deepEqual(statusOf(stopped), { text: '', state: 'streaming' });
  stopped.get('hero-form').emit('submit');
  assert.deepEqual(statusOf(stopped), { text: t.unapproved, state: 'unapproved' });
  void running;
});

test('a copied example resets its label and success styling, and never carries them to another row', async () => {
  const a = app({ languages: ['ko-KR'] });
  const ui = copy.onboardingCopy('ko');
  const button = a.document.querySelector('.editor__btn');
  const clipboard = [];
  a.context.navigator.clipboard = { writeText: async (text) => { clipboard.push(text); } };
  assert.equal(button.textContent, ui.copyExample);

  button.emit('click');
  await nextTurn();
  assert.deepEqual(clipboard, [EXAMPLES.find((row) => row.id === 'ko-fixture-0').after]);
  assert.equal(button.textContent, ui.copied);
  assert.equal(button.classList.contains('is-ok'), true);

  // Switching rows drops the transient result: it belonged to the copied row.
  change(a, 'example-choice', 'ko-fixture-1');
  assert.equal(button.textContent, ui.copyExample);
  assert.equal(button.classList.contains('is-ok'), false, 'success styling must not survive a row change');

  // A failure must not keep the previous success styling.
  button.emit('click');
  await nextTurn();
  assert.equal(button.classList.contains('is-ok'), true);
  a.context.navigator.clipboard = { writeText: async () => { throw new Error('clipboard unavailable'); } };
  button.emit('click');
  await nextTurn();
  assert.equal(button.textContent, ui.copyFailed);
  assert.equal(button.classList.contains('is-ok'), false);

  // The resting label returns so a second copy still reads as an available action.
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.equal(button.textContent, ui.copyExample);
  assert.equal(button.classList.contains('is-ok'), false);
});

test('optional controls open for credentials, close with Escape, and Free restores setup-free sending', () => {
  const a = app();
  const panel = a.get('settings-panel');
  assert.equal(panel.getAttribute('open'), null);
  for (const id of ['lang', 'tier']) {
    assert.equal(panel.querySelector(`#${id}`), null, `${id} stays outside the optional disclosure`);
  }
  for (const id of ['document-type', 'persona', 'register', 'license-key', 'api-key', 'protected-text']) assert.ok(panel.querySelector(`#${id}`));
  a.get('pro-existing').emit('click');
  assert.equal(panel.getAttribute('open'), '');
  assert.equal(a.get('license-key').focused, true);
  // The panel overlays the hero, so Escape must dismiss it from anywhere on the page.
  a.document.emit('keydown', { key: 'Escape' });
  assert.equal(panel.getAttribute('open'), null);
  assert.equal(a.get('settings-label').focused, true);
  // A control inside the panel bubbles its keydown to the document, so one
  // listener covers both; this must not need a second panel-scoped listener.
  a.get('pro-existing').emit('click');
  assert.equal(panel.getAttribute('open'), '');
  a.get('document-type').emit('keydown', { key: 'Escape' });
  assert.equal(panel.getAttribute('open'), null, 'Escape from a control inside the panel dismisses it');
  a.get('pro-existing').emit('click');
  assert.equal(panel.getAttribute('open'), '');
  a.get('hero-input').emit('mousedown');
  assert.equal(panel.getAttribute('open'), null, 'a press outside the panel dismisses it');
  // A press on a control inside the panel must leave it open.
  a.get('pro-existing').emit('click');
  a.get('license-key').emit('mousedown');
  assert.equal(panel.getAttribute('open'), '', 'a press inside the panel keeps it open');
  a.get('price-byok').emit('click');
  assert.equal(panel.getAttribute('open'), '');
  assert.equal(a.get('api-key').focused, true);
  a.get('price-free').emit('click');
  type(a, 'hero-input', 'Source 70%');
  assert.equal(a.get('tier').value, 'free');
  assert.equal(a.get('hero-send').disabled, false);
});


test('funnel arrival runs once after locale/UI initialization and never blocks first use', async () => {
  const arrivals = [];
  const a = app({ languages: ['zh-CN'], funnel: (lang) => arrivals.push(lang) });
  assert.deepEqual(arrivals, ['zh']);
  change(a, 'lang', 'ja');
  await a.ui.submit('English source 70%');
  assert.deepEqual(arrivals, ['zh']);
  const b = app({ languages: ['ko-KR'], funnel: () => { throw new Error('analytics unavailable'); } });
  type(b, 'hero-input', 'Source 70%');
  assert.equal(b.get('hero-send').disabled, false);
});


test('optional settings for a new hero source do not mutate the preceding conversation', async () => {
  const a = app();
  await a.ui.submit('Old source 70%');
  const first = a.ui.activeConvo(), original = snapshot(first);
  a.get('home-link').emit('click');
  type(a, 'hero-input', 'New source 70%');
  change(a, 'document-type', 'email');
  change(a, 'persona', 'natural-en');
  change(a, 'register', 'professional');
  a.get('hero-form').emit('submit');
  await a.settle();
  assert.equal(a.calls.at(-1).body.documentType, 'email');
  assert.equal(a.calls.at(-1).body.persona, 'natural-en');
  assert.equal(a.calls.at(-1).body.mode, 'first');
  assert.deepEqual(snapshot(first), original);
});


for (const lang of ['ko', 'en', 'zh', 'ja']) {
  test(`${lang}: allowlisted URL locale overrides the browser and initializes the funnel`, async () => {
    const arrivals = [];
    const a = app({ search: `?lang=${lang}&utm_source=github`, languages: ['ja-JP', 'ko-KR'], funnel: (value) => arrivals.push(value) });
    assert.equal(a.get('lang').value, lang);
    assert.equal(a.document.documentElement.lang, lang);
    assert.deepEqual(arrivals, [lang]);
    assert.equal(a.get('example-choice').value, `${lang}-fixture-0`);
    change(a, 'lang', 'ko');
    await a.ui.submit('English source 70%');
    assert.equal(a.calls[0].body.lang, 'ko', 'manual selection survives both arrival locale and source detection');
    assert.deepEqual(arrivals, [lang]);
  });
}

test('unsupported URL locale falls back to a supported browser locale, then English', () => {
  assert.equal(app({ search: '?lang=ja-JP', languages: ['zh-CN'] }).get('lang').value, 'zh');
  assert.equal(app({ search: '?lang=constructor', languages: ['fr-FR'] }).get('lang').value, 'en');
});
