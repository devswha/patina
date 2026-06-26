'use strict';

// jsdoc's type parser (catharsis) rejects two TypeScript-flavored JSDoc forms
// that `tsc --checkJs` accepts and that patina's source relies on for precise
// type-checking:
//   - import('./mod.js').Type   (TS import types, e.g. errors.js#PatinaCliError)
//   - { prop?: T }              (optional record properties)
// Without this, `npm run docs:api` aborts (jsdoc exits non-zero) and API.md
// cannot be regenerated. This plugin downgrades only the JSDoc *comment text*
// to the nearest catharsis-parseable equivalent, so the documented signatures
// stay faithful while the rich source annotations are left untouched for tsc.
//
// Comment-only and idempotent: it never sees or mutates runtime code, and the
// two rewrites are no-ops on already-plain JSDoc.
exports.handlers = {
  jsdocCommentFound(e) {
    if (typeof e.comment !== 'string') return;
    e.comment = e.comment
      // import('./errors.js').PatinaCliError -> PatinaCliError
      .replace(/import\((['"])[^'"]*\1\)\./g, '')
      // { warn?: Function } -> { warn: Function } (drop optional marker only;
      // `\w` before `?` leaves regex groups like `(?:` in @example blocks alone)
      .replace(/(\w)\?\s*:/g, '$1:');
  },
};
