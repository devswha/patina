import { htmlEscape } from '../browser-diff.js';
import { describeImage } from '../ocr.js';
import { stripActiveContent } from './dom.js';

const MAX_JUMP_CHIPS = 12;

// "Document context" card for the notes panel: shows the deterministic
// register measurement (and resolved tone) that the rewrite was pinned to,
// so the user can see — and contest — the frame patina applied.
export function buildContextCardHtml({ register = null, tone = null } = {}) {
  const rows = [];
  if (register) {
    const pct = (value) => `${Math.round(value * 100)}%`;
    const distribution = `합쇼체 ${pct(register.shares.formal)} · 해요체 ${pct(register.shares.polite)} · -다체 ${pct(register.shares.plain)}`;
    rows.push(`<div class="ptna-img-text"><span class="ptna-img-label">register</span>${htmlEscape(register.label)} — ${htmlEscape(distribution)}</div>`);
    rows.push(`<div class="ptna-img-text"><span class="ptna-img-label">applied</span>${register.register === 'mixed'
      ? '지배 어투 없음 — 한 어투로 통일하도록 지시됨'
      : '재작성 전체를 이 어투로 통일하도록 지시됨'}</div>`);
  }
  if (tone?.tone && tone.tone !== 'auto') {
    rows.push(`<div class="ptna-img-text"><span class="ptna-img-label">tone</span>${htmlEscape(tone.tone)} (${htmlEscape(tone.tone_source ?? 'user')})</div>`);
  }
  if (rows.length === 0) return '';
  return `<article class="explain-card ptna-ctx-card"><div class="ptna-img-head"><strong>document context</strong></div>${rows.join('')}</article>`;
}

// Models habitually mark identifiers as markdown inline code (`token`) in
// rewrites. The snapshot swap renders plain text, so the pair would show up
// as literal backticks on a page that never had them — strip the pair, keep
// the token. Applied only to the URL/snapshot path; file previews render
// markdown sources where backticks are the author's own formatting.
function stripMarkdownInlineCode(text) {
  return String(text).replace(/`([^`\n]+)`/g, '$1');
}

// Word-level diff for the "diff" view. Whole-sentence strikethrough (the
// "both" view) tells the reader THAT a block changed but not WHAT changed;
// this renders one merged stream per block — common words plain, removed
// words struck, added words highlighted. Tokens are whitespace-separated
// words (Korean eojeol), aligned by LCS; the matrix is capped so a giant
// block degrades to the old whole-text del+ins instead of going quadratic.
const MAX_WORD_DIFF_CELLS = 40000;

export function diffWordSegments(before, after) {
  const a = String(before ?? '').split(/\s+/).filter(Boolean);
  const b = String(after ?? '').split(/\s+/).filter(Boolean);
  const segs = [];
  const push = (type, word) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += ` ${word}`;
    else segs.push({ type, text: word });
  };
  if (a.length * b.length > MAX_WORD_DIFF_CELLS) {
    if (a.length > 0) push('del', a.join(' '));
    if (b.length > 0) push('ins', b.join(' '));
    return segs;
  }
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < m) { push('del', a[i]); i++; }
  while (j < n) { push('ins', b[j]); j++; }
  return segs;
}

function renderWordDiffHtml(before, after) {
  return diffWordSegments(before, after).map((seg) => {
    const text = htmlEscape(seg.text);
    if (seg.type === 'del') return `<del class="ptna-w-del">${text}</del>`;
    if (seg.type === 'ins') return `<ins class="ptna-w-ins">${text}</ins>`;
    return text;
  }).join(' ');
}

export function buildPreviewHtml({ html, blocks, rewrites, sourceUrl, explanationHtml = '', scoreChip = null, imageFindings = [], contextCardHtml = '', variants = null }) {
  // Variant comparison (--preview --jargon x,y / --tone a,b): every
  // variant's rewrite is baked into the same swap span and the bar gets a
  // scriptless radio toggle per variant — the snapshot stays inert, so the
  // switch must be CSS-only, exactly like the rewritten/original/both views.
  const variantList = Array.isArray(variants) && variants.length > 1 ? variants : null;

  let changedCount = 0;
  const planned = blocks.map((block, index) => {
    if (variantList) {
      const texts = variantList.map((variant) => stripMarkdownInlineCode(variant.rewrites[index]));
      if (texts.every((text) => text === block.text)) return null;
      changedCount += 1;
      return { block, texts, n: changedCount };
    }
    const rewritten = stripMarkdownInlineCode(rewrites[index]);
    if (rewritten === block.text) return null;
    changedCount += 1;
    return { block, rewritten, n: changedCount };
  }).filter(Boolean);

  let out = String(html);
  for (const { block, rewritten, texts, n } of [...planned].reverse()) {
    const afters = variantList
      ? texts.map((text, vi) => `<span class="ptna-after ptna-v${vi + 1}">${htmlEscape(text)}</span>`).join('')
      : `<span class="ptna-after">${htmlEscape(rewritten)}</span>`;
    const diffs = variantList
      ? texts.map((text, vi) => `<span class="ptna-diff ptna-v${vi + 1}">${renderWordDiffHtml(block.text, text)}</span>`).join('')
      : `<span class="ptna-diff">${renderWordDiffHtml(block.text, rewritten)}</span>`;
    const replacement = `<span class="ptna-blk" id="ptna-${n}" data-n="${n}">`
      + afters
      + diffs
      + `<span class="ptna-before">${block.raw}</span>`
      + '</span>';
    out = out.slice(0, block.start) + replacement + out.slice(block.end);
  }

  const image = annotateImageFindings(out, imageFindings);
  out = image.html;

  out = stripActiveContent(out);
  out = injectHead(out, sourceUrl);
  out = injectChrome(out, {
    changedCount,
    totalCount: blocks.length,
    explanationHtml,
    scoreChip,
    imageCardsHtml: image.cardsHtml,
    imageChangedCount: image.changedCount,
    contextCardHtml,
    variants: variantList ?? [],
  });
  return { html: out, changedCount, totalCount: blocks.length, imageChangedCount: image.changedCount };
}

// OCR findings cannot be swapped into pixels and the host image is often a
// CSS background, a carousel slide, or lazy-loaded — none reliably visible on
// the frozen snapshot. So each finding's card embeds the exact image patina
// OCR'd (capped thumbnail) alongside the extracted text and suggested rewrite;
// the card itself is the jump target, so a finding is always reachable. When
// the image IS a plain <img> in the DOM it also gets an on-page badge.
function annotateImageFindings(html, imageFindings) {
  let out = html;
  let changedCount = 0;
  const cards = [];
  for (const finding of imageFindings) {
    if (!finding.changed) continue;
    changedCount += 1;
    const n = changedCount;
    if (finding.anchor) {
      const esc = escapeRegExp(finding.anchor);
      const tagRe = new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*(?:"${esc}"|'${esc}'|${esc}(?=[\\s>]))[^>]*>`, 'i');
      out = out.replace(tagRe, (tag) => `<span class="ptna-img" data-n="I${n}">${tag}</span>`);
    }
    const thumb = finding.previewDataUri
      ? `<img class="ptna-img-thumb" alt="" src="${htmlEscape(finding.previewDataUri)}">`
      : '';
    cards.push(
      `<article class="explain-card ptna-img-card" id="ptna-img-${n}">`
      + `<div class="ptna-img-head"><strong>I${n}</strong> · ${htmlEscape(describeImage(finding))}</div>`
      + thumb
      + `<div class="ptna-img-text"><span class="ptna-img-label">image text</span>${htmlEscape(finding.text)}</div>`
      + `<div class="ptna-img-text"><span class="ptna-img-label">suggested</span><span class="ptna-img-suggest">${htmlEscape(finding.rewritten)}</span></div>`
      + '</article>',
    );
  }
  return { html: out, cardsHtml: cards.join(''), changedCount };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// Active content the snapshot strips can still re-enter through markup the
// sanitizer cannot make safe — a data:/javascript: <iframe> renders its own
// document, an <object>/<embed> loads a plugin. Rather than rely on the
// stripper alone, the page-preview document also carries a CSP that forbids
// all script execution and sub-frames while leaving passive resources (the
// page's own images, CSS, fonts) loading for fidelity.
// No base-uri directive: the preview is served from a file:// temp path or
// localhost, so the page's own relative URLs (images, CSS, links) resolve
// only through the injected <base href>. base-uri 'none' would nullify that
// <base> and break every relative resource — and inertness comes from the
// 'none' source directives + stripActiveContent, not from base-uri.
const PREVIEW_CSP = [
  "default-src 'none'",
  'img-src * data: blob:',
  "style-src * 'unsafe-inline'",
  'font-src * data:',
  'media-src * data: blob:',
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join('; ');

function injectHead(html, sourceUrl) {
  // Drop any page-supplied <base>: an attacker <base href="//evil/"> would
  // otherwise survive (it is not a javascript: URL) and govern every relative
  // URL in the inert snapshot. Always resolve relatives against patina's own
  // base for the previewed source instead (#527 H2).
  html = html.replace(/<base\b[^>]*>/gi, '');
  const baseTag = `<base href="${htmlEscape(sourceUrl || '')}">`;
  // CSP first so it governs everything that follows (and the page's own,
  // permissive CSP was already stripped by stripActiveContent).
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const injection = `${csp}${baseTag}<style id="ptna-style">${PREVIEW_CSS}</style>`;
  // Function replacements so `$`-sequences in the injected sourceUrl are literal (#447).
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => `${m}${injection}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${injection}</head>`);
  return `<head>${injection}</head>${html}`;
}

// Group baked variants for the two-level bar UI: one primary button per
// distinct jargon policy (cleanup/explain/remove) and, when a policy carries
// more than one option (tone), a secondary chip row that appears only while
// that policy is selected. Selection is two chained radio groups —
// policy + per-policy option — so the page stays scriptless.
function groupTransformVariants(variants) {
  const groups = [];
  variants.forEach((variant, index) => {
    const key = variant.jargon ?? variant.label ?? `v${index + 1}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: key === 'keep' ? 'cleanup' : key, options: [] };
      groups.push(group);
    }
    const parts = [];
    if (variant.tone) parts.push(variant.tone);
    group.options.push({ label: parts.join('·') || 'default', variantIndex: index + 1 });
  });
  return groups;
}

function injectChrome(html, { changedCount, totalCount, explanationHtml = '', scoreChip = null, imageCardsHtml = '', imageChangedCount = 0, contextCardHtml = '', variants = [] }) {
  const hasVariants = variants.length > 1 && changedCount > 0;
  const variantGroups = hasVariants ? groupTransformVariants(variants) : [];
  const inputs = changedCount > 0
    ? '<input type="radio" name="ptna-view" id="ptna-v-rew" class="ptna-toggle-input" checked>'
      + '<input type="radio" name="ptna-view" id="ptna-v-orig" class="ptna-toggle-input">'
      + '<input type="radio" name="ptna-view" id="ptna-v-both" class="ptna-toggle-input">'
      + '<input type="radio" name="ptna-view" id="ptna-v-diff" class="ptna-toggle-input">'
    : '';
  // Depth and option radios MUST come after the view radios in the DOM, and
  // option radios after depth radios: the show rules chain all three groups
  // with the general-sibling combinator (#ptna-v-rew:checked ~
  // #ptna-d-D:checked ~ #ptna-do-D-O:checked ~ * …), which only matches when
  // each later input is a later sibling. Every depth keeps its own option
  // radio group (name="ptna-opt-D"), so switching depth remembers the option
  // previously picked inside it.
  const depthInputs = variantGroups.map((_, di) =>
    `<input type="radio" name="ptna-depth" id="ptna-d-${di + 1}" class="ptna-toggle-input"${di === 0 ? ' checked' : ''}>`).join('');
  const optionInputs = variantGroups.map((group, di) =>
    group.options.map((_, oi) =>
      `<input type="radio" name="ptna-opt-${di + 1}" id="ptna-do-${di + 1}-${oi + 1}" class="ptna-toggle-input"${oi === 0 ? ' checked' : ''}>`).join('')).join('');
  const chips = Array.from({ length: Math.min(changedCount, MAX_JUMP_CHIPS) }, (_, i) =>
    `<a class="ptna-chip" href="#ptna-${i + 1}">${i + 1}</a>`).join('');
  const overflow = changedCount > MAX_JUMP_CHIPS
    ? `<span class="ptna-chip ptna-chip-more">+${changedCount - MAX_JUMP_CHIPS}</span>`
    : '';
  const imageChips = Array.from({ length: Math.min(imageChangedCount, MAX_JUMP_CHIPS) }, (_, i) =>
    `<a class="ptna-chip ptna-chip-img" href="#ptna-img-${i + 1}">I${i + 1}</a>`).join('');
  const depthButtons = hasVariants
    ? `<div class="ptna-views ptna-variants">`
      + variantGroups.map((group, di) =>
        `<label class="ptna-view" for="ptna-d-${di + 1}">${htmlEscape(group.label)}</label>`).join('')
      + '</div>'
    : '';
  const optionButtons = hasVariants
    ? variantGroups.map((group, di) => group.options.length > 1
      ? `<div class="ptna-views ptna-opts ptna-opts-${di + 1}">`
        + group.options.map((option, oi) =>
          `<label class="ptna-view" for="ptna-do-${di + 1}-${oi + 1}">${htmlEscape(option.label)}</label>`).join('')
        + '</div>'
      : '').join('')
    : '';
  const views = changedCount > 0
    ? '<div class="ptna-views">'
      + '<label class="ptna-view" for="ptna-v-rew">rewritten</label>'
      + '<label class="ptna-view" for="ptna-v-orig">original</label>'
      + '<label class="ptna-view" for="ptna-v-both">both</label>'
      + '<label class="ptna-view" for="ptna-v-diff">diff</label>'
      + '</div>'
    : '';
  const notesBody = `${contextCardHtml}${explanationHtml}${imageCardsHtml}`;
  // Auto-open when there are image findings — they have no in-page diff, so a
  // collapsed panel would hide the only place they appear.
  const open = imageChangedCount > 0 ? ' open' : '';
  const summaryLabel = imageChangedCount > 0 ? `patina notes · ${imageChangedCount} image text` : 'patina notes';
  const notes = notesBody
    ? `<details class="ptna-notes"${open}><summary>${summaryLabel}</summary><div class="ptna-notes-body">${notesBody}</div></details>`
    : '';
  const bar = `<div class="ptna-bar"><span class="ptna-brand">patina</span>`
    + `<span class="ptna-count">${changedCount} of ${totalCount} blocks rewritten</span>`
    + (imageChangedCount > 0 ? `<span class="ptna-count ptna-count-img">${imageChangedCount} image(s)</span>` : '')
    + (scoreChip ? `<span class="ptna-score">${htmlEscape(scoreChip)}</span>` : '')
    + (chips || imageChips ? `<nav class="ptna-jump" aria-label="Jump to rewrite">${chips}${overflow}${imageChips}</nav>` : '')
    + depthButtons
    + optionButtons
    + views
    + '</div>';

  let out = html;
  if (/<body\b[^>]*>/i.test(out)) out = out.replace(/<body\b[^>]*>/i, (m) => `${m}${inputs}${depthInputs}${optionInputs}`);
  else out = `${inputs}${depthInputs}${optionInputs}${out}`;
  const variantCss = hasVariants ? buildVariantCss(variantGroups) : '';
  // Function replacement so `$`-sequences in notes (LLM explanation + OCR'd image
  // text) are not interpreted as replacement patterns (#447).
  if (/<\/body\s*>/i.test(out)) return out.replace(/<\/body\s*>/i, (m) => `${variantCss}${notes}${bar}${m}`);
  return `${out}${variantCss}${notes}${bar}`;
}

// CSS for the scriptless two-level variant toggle. Base rules hide every
// variant span and every option chip row; each show rule chains the view
// radio, the depth radio, and that depth's option radio (three ids — wins
// every specificity fight), so exactly one variant is visible in the
// rewritten/both/diff views and the original view hides them all. The
// selected depth reveals its own option row; highlights mirror the view
// toggle.
function buildVariantCss(groups) {
  const rules = ['.ptna-blk .ptna-after{display:none !important;}'];
  // Re-hide all diff spans: PREVIEW_CSS's single-variant show rule
  // (#ptna-v-diff:checked ~ * .ptna-blk .ptna-diff) would otherwise show
  // EVERY variant's diff at once. Equal specificity + later in the document
  // wins, then the three-id per-variant rules below override this re-hide.
  rules.push('#ptna-v-diff:checked ~ * .ptna-blk .ptna-diff{display:none !important;}');
  rules.push('.ptna-opts{display:none !important;}');
  groups.forEach((group, gi) => {
    const d = gi + 1;
    rules.push(`#ptna-d-${d}:checked ~ .ptna-bar label[for="ptna-d-${d}"]{background:rgba(216,182,106,0.22);color:#d8b66a;}`);
    rules.push(`#ptna-d-${d}:checked ~ .ptna-bar .ptna-opts-${d}{display:inline-flex !important;}`);
    group.options.forEach((option, oi) => {
      const o = oi + 1;
      const k = option.variantIndex;
      rules.push(`#ptna-v-rew:checked ~ #ptna-d-${d}:checked ~ #ptna-do-${d}-${o}:checked ~ * .ptna-blk .ptna-after.ptna-v${k}{display:inline !important;}`);
      rules.push(`#ptna-v-both:checked ~ #ptna-d-${d}:checked ~ #ptna-do-${d}-${o}:checked ~ * .ptna-blk .ptna-after.ptna-v${k}{display:inline !important;}`);
      rules.push(`#ptna-v-diff:checked ~ #ptna-d-${d}:checked ~ #ptna-do-${d}-${o}:checked ~ * .ptna-blk .ptna-diff.ptna-v${k}{display:inline !important;}`);
      rules.push(`#ptna-do-${d}-${o}:checked ~ .ptna-bar label[for="ptna-do-${d}-${o}"]{background:rgba(95,196,168,0.18);color:#5fc4a8;}`);
    });
  });
  rules.push('.ptna-variants{border-color:rgba(216,182,106,0.45);}');
  rules.push('.ptna-opts{border-color:rgba(95,196,168,0.4);}');
  return `<style>${rules.join('')}</style>`;
}

// All selectors are ptna-prefixed and critical properties carry !important
// so the host page's stylesheet cannot hide the overlay. Three view states
// (radio hack, no JS): rewritten (default), original, both — "both" keeps
// the rewrite and shows the struck-through original beside it.
const PREVIEW_CSS = `
.ptna-toggle-input{position:absolute !important;width:1px;height:1px;opacity:0;}
.ptna-blk{scroll-margin-top:90px;}
.ptna-srcdoc{display:block;container-type:inline-size;}
.ptna-blk .ptna-before{display:none !important;}
.ptna-blk .ptna-diff{display:none !important;}
#ptna-v-diff:checked ~ * .ptna-blk .ptna-diff{display:inline !important;border-radius:3px;padding:0 2px;color:inherit;}
#ptna-v-diff:checked ~ * .ptna-blk .ptna-after{display:none !important;}
.ptna-w-del{color:#e8a193 !important;background:rgba(200,100,90,0.16) !important;text-decoration:line-through !important;text-decoration-color:#c86c5c !important;border-radius:3px;padding:0 2px;}
.ptna-w-ins{color:inherit !important;background:rgba(95,196,168,0.26) !important;box-shadow:inset 0 -2px 0 #5fc4a8 !important;border-radius:3px;padding:0 2px;text-decoration:none !important;}
.ptna-blk .ptna-after{background:rgba(95,196,168,0.20) !important;box-shadow:inset 0 -2px 0 #5fc4a8 !important;border-radius:3px;padding:0 2px;color:inherit;}
#ptna-v-orig:checked ~ * .ptna-blk .ptna-after{display:none !important;}
#ptna-v-orig:checked ~ * .ptna-blk .ptna-before{display:inline !important;background:rgba(200,149,108,0.20) !important;box-shadow:inset 0 -2px 0 #c8956c !important;border-radius:3px;padding:0 2px;color:inherit;}
#ptna-v-both:checked ~ * .ptna-blk .ptna-before{display:inline !important;background:rgba(200,149,108,0.16) !important;box-shadow:inset 0 -2px 0 #c8956c !important;border-radius:3px;padding:0 2px;color:inherit;text-decoration:line-through;opacity:0.75;margin-left:7px;}
.ptna-blk::before{content:attr(data-n);display:inline-block !important;min-width:16px;margin-right:6px;text-align:center;border-radius:999px;background:#5fc4a8;color:#0b201a;font:700 10px/16px ui-monospace,Menlo,Consolas,monospace !important;vertical-align:2px;}
#ptna-v-orig:checked ~ * .ptna-blk::before{background:#c8956c;color:#20150c;}
.ptna-blk:target .ptna-after,#ptna-v-orig:checked ~ * .ptna-blk:target .ptna-before{outline:2px solid #5fc4a8 !important;outline-offset:2px;}
.ptna-bar{position:fixed !important;left:50% !important;bottom:18px !important;transform:translateX(-50%);z-index:2147483647 !important;display:flex !important;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;max-width:94vw;padding:9px 16px;border-radius:999px;border:1px solid rgba(95,196,168,0.4);background:rgba(11,14,13,0.93) !important;color:#cfe2d8 !important;font:600 11px/1.2 ui-monospace,Menlo,Consolas,monospace !important;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 6px 28px rgba(0,0,0,0.45);}
.ptna-brand{color:#5fc4a8 !important;letter-spacing:0.16em;}
.ptna-count{color:#8da59a !important;}
.ptna-score{color:#d8b66a !important;}
.ptna-jump{display:flex;gap:5px;flex-wrap:wrap;}
.ptna-chip{min-width:22px;text-align:center;padding:3px 0;border:1px solid rgba(95,196,168,0.35);border-radius:999px;color:#5fc4a8 !important;text-decoration:none !important;font:inherit !important;}
.ptna-chip:hover{background:rgba(95,196,168,0.15);}
.ptna-chip-more{border-color:rgba(141,165,154,0.3);color:#8da59a !important;}
.ptna-chip-img{color:#c8956c !important;border-color:rgba(200,149,108,0.4);}
.ptna-chip-img:hover{background:rgba(200,149,108,0.15);}
.ptna-count-img{color:#c8956c !important;}
.ptna-img{display:inline-block;position:relative;outline:2px dashed #c8956c !important;outline-offset:3px;border-radius:4px;scroll-margin-top:90px;}
.ptna-img::after{content:attr(data-n);position:absolute;top:6px;left:6px;padding:1px 7px;border-radius:999px;background:#c8956c;color:#20150c;font:700 10.5px/16px ui-monospace,Menlo,Consolas,monospace !important;}
.ptna-img:target{outline-style:solid !important;outline-width:3px !important;}
.ptna-img-card{border-left-color:#c8956c !important;background:rgba(200,149,108,0.05) !important;scroll-margin-top:16px;}
.ptna-img-card:target{outline:2px solid #c8956c !important;outline-offset:2px;}
.ptna-img-head{font-size:11px;color:#8da59a;margin-bottom:7px;}
.ptna-img-head strong{color:#c8956c;}
.ptna-img-thumb{display:block;max-width:100%;max-height:220px;width:auto;border-radius:6px;border:1px solid rgba(132,168,152,0.25);margin:0 0 8px;}
.ptna-img-text{margin:5px 0;line-height:1.6;}
.ptna-img-label{display:inline-block;min-width:62px;font:600 9.5px/1.6 ui-monospace,Menlo,Consolas,monospace !important;text-transform:uppercase;letter-spacing:0.08em;color:#8da59a;vertical-align:top;}
.ptna-img-suggest{color:#5fc4a8;}
.ptna-ctx-card{border-left-color:#d8b66a !important;background:rgba(216,182,106,0.05) !important;}
.ptna-views{display:inline-flex;border:1px solid rgba(141,165,154,0.4);border-radius:999px;overflow:hidden;}
.ptna-view{padding:4px 11px;cursor:pointer;user-select:none;color:#8da59a;font:inherit;}
.ptna-view:hover{color:#cfe2d8;}
#ptna-v-rew:checked ~ .ptna-bar label[for="ptna-v-rew"]{background:rgba(95,196,168,0.22);color:#5fc4a8;}
#ptna-v-orig:checked ~ .ptna-bar label[for="ptna-v-orig"]{background:rgba(200,149,108,0.22);color:#c8956c;}
#ptna-v-both:checked ~ .ptna-bar label[for="ptna-v-both"]{background:rgba(216,182,106,0.20);color:#d8b66a;}
#ptna-v-diff:checked ~ .ptna-bar label[for="ptna-v-diff"]{background:rgba(95,196,168,0.22);color:#5fc4a8;}
.ptna-notes{position:fixed !important;right:18px;bottom:74px;z-index:2147483646 !important;max-width:min(440px,92vw);font:13px/1.7 "Apple SD Gothic Neo",Pretendard,"Noto Sans KR","Segoe UI",sans-serif !important;color:#dde7e0 !important;}
.ptna-notes summary{cursor:pointer;list-style:none;display:inline-block;padding:6px 13px;border-radius:999px;border:1px solid rgba(216,182,106,0.45);background:rgba(11,14,13,0.93);color:#d8b66a;font:600 11px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:0.08em;text-transform:uppercase;float:right;}
.ptna-notes summary::-webkit-details-marker{display:none;}
.ptna-notes[open] summary{border-bottom-left-radius:0;border-bottom-right-radius:0;}
.ptna-notes-body{clear:both;max-height:46vh;overflow:auto;margin-top:2px;padding:12px 14px;border:1px solid rgba(216,182,106,0.35);border-radius:12px;background:rgba(11,14,13,0.96);}
.ptna-notes-body .explain-card{border:1px solid rgba(132,168,152,0.2);border-left:3px solid #5fc4a8;border-radius:8px;padding:9px 12px;margin:0 0 10px;background:rgba(95,196,168,0.05);}
.ptna-notes-body .explain-card:last-child{margin-bottom:0;}
.ptna-notes-body .explain-card strong{color:#d8b66a;}
.ptna-notes-body .explain-card code{font:12px ui-monospace,Menlo,Consolas,monospace;background:rgba(200,149,108,0.14);border-radius:4px;padding:1px 4px;color:#e8c9a8;}
@media (prefers-reduced-motion:reduce){.ptna-view{transition:none !important;}}
`.replace(/\n/g, '');

