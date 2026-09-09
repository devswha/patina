// @ts-check
// Conversation settings for one rewrite thread. Nothing here is persisted:
// settings live for the life of the conversation and are never written to
// browser storage.
import { SUPPORTED_LANGS, WEB_DOCUMENT_TYPES, WEB_REGISTERS, isWebPersonaAllowed } from '../src/web-rewrite-contract.js';

/** @param {{lang?:string, documentType?:string, persona?:string, register?:string}} [input] */
export function normalizePreferences(input = {}) {
  const lang = SUPPORTED_LANGS.includes(input?.lang) ? input.lang : 'en';
  const documentType = WEB_DOCUMENT_TYPES.includes(input?.documentType)
    && (input.documentType !== 'namuwiki' || lang === 'ko') ? input.documentType : 'default';
  return {
    lang,
    documentType,
    persona: isWebPersonaAllowed(lang, input?.persona) ? input.persona : '',
    register: WEB_REGISTERS.includes(input?.register) ? input.register : '',
  };
}

export function createThreadPreferences(initial = {}, languageExplicit = false) {
  let value = normalizePreferences(initial);
  let anchored = false;
  return {
    get value() { return { ...value }; },
    get languageExplicit() { return languageExplicit; },
    update(patch, { explicitLanguage = false } = {}) {
      const next = normalizePreferences({ ...value, ...patch });
      // Do not partially apply settings whose language conflicts with the source.
      if (anchored && next.lang !== value.lang) return false;
      value = next;
      if (explicitLanguage) languageExplicit = true;
      return true;
    },
    detect(lang) {
      if (!anchored && !languageExplicit && SUPPORTED_LANGS.includes(lang)) {
        value = normalizePreferences({ ...value, lang });
      }
      return { ...value };
    },
    anchor() { anchored = true; },
    reset() { anchored = false; },
  };
}
