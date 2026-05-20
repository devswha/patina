#!/usr/bin/env node

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_STACK = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans CJK KR', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const SNIPPET_LIMIT = 280;

/**
 * Escape text for safe SVG/XML text nodes and attributes.
 *
 * @param {string} value Untrusted user text.
 * @returns {string} XML-safe text.
 * @example
 * escapeXml('<tag & value>');
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalize and truncate share-card snippets before rendering.
 *
 * @param {string} value Source or rewritten text.
 * @param {number} [limit=280] Maximum visible code points.
 * @returns {string} Truncated snippet with a single ellipsis when needed.
 * @example
 * truncateText('a'.repeat(300));
 */
export function truncateText(value, limit = SNIPPET_LIMIT) {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return `${chars.slice(0, Math.max(0, limit - 1)).join('').trimEnd()}…`;
}

/**
 * Render a 1200x630 SVG before/after social card.
 *
 * @param {object} input Card input.
 * @param {string} input.before Source text snippet.
 * @param {string} input.after Rewritten text snippet.
 * @param {number|null} input.aiScore AI-likeness score, 0-100.
 * @param {number|null} input.mps Meaning preservation score, 0-100.
 * @param {string} [input.lang] Language code.
 * @returns {string} SVG document string.
 * @example
 * renderShareCard({ before: 'AI-sounding text', after: 'Cleaner text', aiScore: 21, mps: 94, lang: 'en' });
 */
export function renderShareCard({ before, after, aiScore, mps, lang = 'ko' } = {}) {
  const beforeLines = wrapSnippet(truncateText(before), { maxCharsPerLine: 34, maxLines: 6 });
  const afterLines = wrapSnippet(truncateText(after), { maxCharsPerLine: 34, maxLines: 6 });
  const aiLabel = formatScore(aiScore, '/100');
  const mpsLabel = formatScore(mps);
  const langLabel = String(lang || 'auto').toUpperCase();
  const title = `patina before/after card — AI score ${aiLabel}, MPS ${mpsLabel}`;
  const desc = `A patina share card comparing a ${langLabel} source snippet with its meaning-preserving rewrite.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(desc)}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="55%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#1f2937"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <g id="patina-brand-mark" transform="translate(72 39) scale(0.10546875)" aria-hidden="true">
    <path d="M92 196C160 86 320 74 420 164L346 238C288 190 218 198 174 258Z" fill="#c46a2a"/>
    <path d="M420 316C352 426 192 438 92 348L160 270C224 322 294 314 338 254Z" fill="#2dd4bf"/>
    <circle cx="252" cy="248" r="54" fill="#ffe6a8" stroke="#020617" stroke-width="10"/>
  </g>
  <text x="142" y="78" fill="#f9fafb" font-family="${FONT_STACK}" font-size="46" font-weight="800" letter-spacing="-1.5">patina</text>
  <text x="72" y="122" fill="#a7f3d0" font-family="${FONT_STACK}" font-size="24" font-weight="650">Strip the AI packaging. Keep the meaning.</text>

  <g filter="url(#shadow)">
    <rect x="72" y="158" width="500" height="330" rx="26" fill="#111827" stroke="#374151" stroke-width="2"/>
    <text x="104" y="210" fill="#fca5a5" font-family="${FONT_STACK}" font-size="24" font-weight="800">Before</text>
    <text x="104" y="258" fill="#e5e7eb" font-family="${FONT_STACK}" font-size="24">
${renderTspans(beforeLines, 104, 0, 37)}
    </text>
  </g>

  <text x="596" y="332" fill="#93c5fd" font-family="${FONT_STACK}" font-size="42" font-weight="800">→</text>

  <g filter="url(#shadow)">
    <rect x="628" y="158" width="500" height="330" rx="26" fill="#ecfdf5" stroke="#34d399" stroke-width="2"/>
    <text x="660" y="210" fill="#047857" font-family="${FONT_STACK}" font-size="24" font-weight="800">After</text>
    <text x="660" y="258" fill="#064e3b" font-family="${FONT_STACK}" font-size="24">
${renderTspans(afterLines, 660, 0, 37)}
    </text>
  </g>

  <g aria-label="score summary">
    ${renderPill(72, 516, `AI score ${aiLabel}`, '#dbeafe', '#1d4ed8')}
    ${renderPill(350, 516, `MPS ${mpsLabel}`, '#dcfce7', '#047857')}
    ${renderPill(520, 516, `LANG ${langLabel}`, '#fef3c7', '#92400e')}
  </g>

  <text x="72" y="574" fill="#d1d5db" font-family="${FONT_STACK}" font-size="23">Pattern-based · auditable · KO/EN/ZH/JA · Claude Code · Codex CLI · Cursor · OpenCode · Node CLI</text>
  <text x="72" y="606" fill="#93c5fd" font-family="${FONT_STACK}" font-size="22" font-weight="700">github.com/devswha/patina</text>
</svg>
`;
}

function wrapSnippet(text, { maxCharsPerLine, maxLines }) {
  const words = tokenizeForWrapping(text);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (visibleLength(`${current}${needsSpace(current, word) ? ' ' : ''}${word}`) <= maxCharsPerLine) {
      current = `${current}${needsSpace(current, word) ? ' ' : ''}${word}`;
    } else {
      lines.push(current);
      current = word;
    }

    while (visibleLength(current) > maxCharsPerLine) {
      lines.push(Array.from(current).slice(0, maxCharsPerLine).join(''));
      current = Array.from(current).slice(maxCharsPerLine).join('');
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines.length > 0 ? lines : [''];

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ensureTrailingEllipsis(kept[maxLines - 1], maxCharsPerLine);
  return kept;
}

function tokenizeForWrapping(text) {
  if (!text) return [''];
  const parts = String(text).split(/(\s+)/u).filter((part) => part && !/^\s+$/u.test(part));
  if (parts.length > 1) return parts;
  return Array.from(String(text));
}

function needsSpace(left, right) {
  if (!left || !right) return false;
  return /[\p{L}\p{N})\].,!?;:'"%]$/u.test(left) && /^[\p{L}\p{N}([{]/u.test(right);
}

function visibleLength(text) {
  return Array.from(String(text || '')).length;
}

function ensureTrailingEllipsis(text, maxChars) {
  const chars = Array.from(String(text || '').replace(/…$/u, ''));
  if (chars.length >= maxChars) return `${chars.slice(0, Math.max(0, maxChars - 1)).join('').trimEnd()}…`;
  return `${chars.join('').trimEnd()}…`;
}

function renderTspans(lines, x, firstDy, lineHeight) {
  return lines
    .map((line, index) => `      <tspan x="${x}" dy="${index === 0 ? firstDy : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('\n');
}

function renderPill(x, y, label, bg, fg) {
  const width = Math.max(132, 22 + visibleLength(label) * 13);
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="38" rx="19" fill="${bg}"/><text x="18" y="25" fill="${fg}" font-family="${FONT_STACK}" font-size="18" font-weight="800">${escapeXml(label)}</text></g>`;
}

function formatScore(value, suffix = '') {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`;
}
