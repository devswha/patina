// @ts-check
// patina-lane: A — deterministic document-brief signals. LLM-free.
import { detectKoreanRegister } from './stylometry.js';

/**
 * Deterministic document signals for the rewrite prompt (document-brief
 * stage). Korean only for now: the dominant register is measured, not
 * guessed, so the model gets it as ground truth instead of re-deriving it.
 *
 * @param {object} options
 * @param {string} options.text Source text.
 * @param {string} [options.lang] Language code.
 * @returns {{ signals: string[], register: object|null }}
 */
export function buildDocumentSignals({ text, lang }) {
  if (lang !== 'ko') return { signals: [], register: null };
  const register = detectKoreanRegister(text);
  if (!register) return { signals: [], register: null };
  const pct = (value) => `${Math.round(value * 100)}%`;
  const distribution = `합쇼체 ${pct(register.shares.formal)} · 해요체 ${pct(register.shares.polite)} · -다체 ${pct(register.shares.plain)} (문장 ${register.classified}개 기준)`;
  const signals = register.register === 'mixed'
    ? [`어미 분포: ${distribution} — 지배 어투 없음(혼합). 문서 성격에 맞는 어투 하나를 골라 전체를 통일할 것`]
    : [`지배 어투: ${register.label} — ${distribution}. 재작성 문장 전체를 이 어투로 통일할 것`];
  return { signals, register };
}
