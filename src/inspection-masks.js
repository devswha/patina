// Conservative source-length-preserving masks for localized editor hints.
// The detector itself still receives the original text.
export function maskInspectionNonProse(text) {
  const output = text.split('');
  const boundaries = [];
  const blank = (start, end) => {
    for (let i = start; i < end; i++) {
      if (text[i] !== '\n' && text[i] !== '\r') output[i] = ' ';
    }
  };

  let fence = null;
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline + 1;
    let cursor = start;
    while (cursor < end && text[cursor] === ' ' && cursor - start < 4) cursor++;
    const character = text[cursor];
    let width = 0;
    if (cursor - start <= 3 && (character === '`' || character === '~')) {
      while (text[cursor + width] === character) width++;
    }
    const rest = text.slice(cursor + width, end).trim();
    if (fence) {
      blank(start, end);
      if (character === fence.character && width >= fence.width && !rest) {
        fence = null;
        boundaries.push(end);
      }
    } else if (width >= 3 && (character !== '`' || !rest.includes('`'))) {
      fence = { character, width };
      boundaries.push(start);
      blank(start, end);
    }
    start = end;
  }
  for (const match of text.matchAll(/\n[ \t\r]*\n/g)) boundaries.push(match.index + match[0].length);
  boundaries.sort((a, b) => a - b);

  // Index backtick runs once. Matching lookup remains linear on long inputs
  // with unmatched delimiters, rather than rescanning the suffix for each run.
  const runs = [];
  const byStart = new Map();
  let boundary = 0;
  for (let i = 0; i < text.length;) {
    while (boundary < boundaries.length && boundaries[boundary] <= i) boundary++;
    if (output[i] !== '`') {
      i++;
      continue;
    }
    const start = i;
    while (output[i] === '`') i++;
    const run = { start, end: i, width: i - start, group: boundary, next: -1 };
    byStart.set(start, runs.length);
    runs.push(run);
  }
  const next = new Map();
  for (let i = runs.length - 1; i >= 0; i--) {
    const key = `${runs[i].group}/${runs[i].width}`;
    runs[i].next = next.get(key) ?? -1;
    next.set(key, i);
  }

  for (let i = 0; i < text.length;) {
    if (output[i] === '`') {
      const run = runs[byStart.get(i)];
      if (run?.next >= 0) {
        const end = runs[run.next].end;
        blank(i, end);
        i = end;
        continue;
      }
      i = run?.end || i + 1;
      continue;
    }
    if (output[i] !== '<' || !/[a-zA-Z!/?]/.test(text[i + 1] || '')) {
      i++;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const end = close < 0 ? text.length : close + 3;
      blank(i, end);
      i = end;
      continue;
    }
    let quote = null;
    let end = i + 1;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        end++;
        break;
      }
    }
    const tag = text.slice(i, end).match(/^<\s*(script|style)(?=[\s>])/i)?.[1]?.toLowerCase();
    if (tag) {
      const closingTag = new RegExp(`</${tag}(?=[\\s/>])`, 'ig');
      closingTag.lastIndex = end;
      const close = closingTag.exec(text);
      if (!close) {
        end = text.length;
      } else {
        const closeEnd = text.indexOf('>', close.index);
        end = closeEnd < 0 ? text.length : closeEnd + 1;
      }
    }
    blank(i, end);
    i = end;
  }
  return output.join('');
}
