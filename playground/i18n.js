// Browser-pure UI string catalog for the patina playground.
//
// No imports, no DOM, no `node:` — deterministic data only, so this module stays
// inside the browser-pure static graph (walked by the playground graph tests) and
// is fully unit-testable in node. It localizes ONLY presentation strings; the
// analyzer's signal/scoring data layer stays English and language-agnostic.
//
// `lang` (ko/en/zh/ja) is the text being audited; `ui` (en/ko) is the interface
// language this module serves. The two axes are independent.

export const UI_LANGS = ['en', 'ko'];
export const DEFAULT_UI_LANG = 'en';

export function normalizeUiLang(value) {
  return UI_LANGS.includes(value) ? value : DEFAULT_UI_LANG;
}

// Stable score-band keys → display label. The band key comes from the analyzer
// (scoreBand().key), so localization never depends on the English label text.
const BAND = {
  en: { low: 'Low AI-likeness', mixed: 'Mixed signals', high: 'Review suggested' },
  ko: { low: 'AI 가능성 낮음', mixed: '혼재된 신호', high: '검토 권장' },
};

// Reason labels keyed by the stable reason `code` emitted by buildReasons().
const REASON_LABELS = {
  en: {
    'fake-candor': 'Fake-candor opener',
    'thematic-break': 'Decorative thematic break',
    'model-output-leakage': 'Model-output leakage',
    'em-dash-overuse': 'Em dash overuse',
    'bold-overuse': 'Boldface overuse',
    'emoji-overuse': 'Emoji overuse',
    'low-burstiness': 'Low burstiness',
    'low-mattr': 'Low lexical variety',
    'lexicon-density': 'AI-favored phrasing density',
    'lexicon-hit': 'AI-favored phrase present',
    'ko-diagnostics': 'Korean rhythm composite',
    'ko-ending-monotony': 'Uniform plain-다 register',
  },
  ko: {
    'fake-candor': '가짜 솔직함 도입부',
    'thematic-break': '장식용 구분선',
    'model-output-leakage': '모델 출력 누출',
    'em-dash-overuse': '엠대시 남용',
    'bold-overuse': '볼드체 남용',
    'emoji-overuse': '이모지 남용',
    'low-burstiness': '낮은 버스트성',
    'low-mattr': '낮은 어휘 다양성',
    'lexicon-density': 'AI 선호 표현 밀도',
    'lexicon-hit': 'AI 선호 표현 존재',
    'ko-diagnostics': '한국어 리듬 복합 신호',
    'ko-ending-monotony': '단조로운 평서형 -다 문체',
  },
};

// Reason detail builders keyed by code. Each receives the structured `vars`
// captured on the reason, so any language can re-template from the same numbers.
const REASON_DETAILS = {
  en: {
    'fake-candor': (v) =>
      `Manufactured-intimacy opener ("here's the thing", "the truth is", …); ${v.docCount} in the document (threshold ${v.threshold}).`,
    'thematic-break': (v) =>
      `${v.docCount} markdown dividers in the document (threshold ${v.threshold}); this paragraph carries ${v.count}.`,
    'model-output-leakage': (v) =>
      `Pasted-LLM artifact present (${v.labels}). A single hit is near-proof-grade.`,
    'em-dash-overuse': (v) =>
      `${v.docEmDash} em dashes in the document (threshold ${v.threshold}); this paragraph carries ${v.emDash}.`,
    'bold-overuse': (v) =>
      v.paragraphOnly
        ? `${v.bold} bold spans in this paragraph (threshold ${v.boldParagraph}).`
        : `${v.docBold} bold spans in the document (threshold ${v.boldDoc}); this paragraph carries ${v.bold}.`,
    'emoji-overuse': (v) =>
      `${v.docEmoji} emoji in the document (catalog threshold: any occurrence); this paragraph carries ${v.emoji}.`,
    'low-burstiness': () => 'Sentence lengths are unusually even, a common polished-LLM tell.',
    'low-mattr': () => 'The moving type-token ratio is below the editing threshold.',
    'lexicon-density': (v) =>
      `${v.matches} lexicon hit${v.matches === 1 ? '' : 's'} / ${v.density} per 1k tokens.`,
    'lexicon-hit': (v) =>
      `${v.matches} lexicon hit${v.matches === 1 ? '' : 's'}, below the hot-zone threshold.`,
    'ko-diagnostics': (v) =>
      `Regular spacing, low comma rhythm, and low suffix diversity matched together (strength ${v.strength}).`,
    'ko-ending-monotony': () =>
      'Flat declarative -다 endings with little sentence-length variation, a short-form LLM Korean tell.',
  },
  ko: {
    'fake-candor': (v) =>
      `인위적 친밀감 도입부("here's the thing", "the truth is" 등); 문서 전체에 ${v.docCount}개 (임계값 ${v.threshold}).`,
    'thematic-break': (v) =>
      `문서에 마크다운 구분선 ${v.docCount}개 (임계값 ${v.threshold}); 이 문단에는 ${v.count}개.`,
    'model-output-leakage': (v) =>
      `붙여넣은 LLM 산출물 흔적 발견 (${v.labels}). 한 번만 나와도 거의 확정적입니다.`,
    'em-dash-overuse': (v) =>
      `문서에 엠대시 ${v.docEmDash}개 (임계값 ${v.threshold}); 이 문단에는 ${v.emDash}개.`,
    'bold-overuse': (v) =>
      v.paragraphOnly
        ? `이 문단에 볼드 ${v.bold}개 (임계값 ${v.boldParagraph}).`
        : `문서에 볼드 ${v.docBold}개 (임계값 ${v.boldDoc}); 이 문단에는 ${v.bold}개.`,
    'emoji-overuse': (v) =>
      `문서에 이모지 ${v.docEmoji}개 (카탈로그 임계값: 1회라도 등장 시); 이 문단에는 ${v.emoji}개.`,
    'low-burstiness': () => '문장 길이가 비정상적으로 균일합니다. 다듬어진 LLM 글의 흔한 신호입니다.',
    'low-mattr': () => '이동 평균 타입-토큰 비율이 편집 임계값 아래입니다.',
    'lexicon-density': (v) => `어휘 적중 ${v.matches}건 / 1k 토큰당 ${v.density}건.`,
    'lexicon-hit': (v) => `어휘 적중 ${v.matches}건, 핫존 임계값 미만.`,
    'ko-diagnostics': (v) =>
      `규칙적 띄어쓰기, 낮은 쉼표 리듬, 낮은 어미 다양성이 동시에 일치 (강도 ${v.strength}).`,
    'ko-ending-monotony': () =>
      '평서형 -다 어미가 단조롭고 문장 길이 변화가 거의 없습니다. 짧은 글 LLM 한국어의 신호입니다.',
  },
};

// koPostEditese advisory row group + metric label translations (en is the
// identity / source-of-truth literal used by the analyzer's row table).
const KO_PE_GROUP = {
  endings: '어미',
  interference: '간섭',
  rhythm: '리듬',
  'suffix diversity': '어미 다양성',
};
const KO_PE_METRIC = {
  'declarative -다 count': '평서형 -다 개수',
  'declarative -다 ratio': '평서형 -다 비율',
  'formal ending count': '격식체 어미 개수',
  'polite ending count': '해요체 어미 개수',
  'ending streak max': '동일 어미 최대 연속',
  'pronoun literal count': '대명사 직역 개수',
  'double particle count': '겹조사 개수',
  'progressive aspect count': '진행상 개수',
  'light verb count': '경동사 개수',
  'by-passive count': '~에 의한 피동 개수',
  'double passive count': '이중 피동 개수',
  'connective comma count': '연결 쉼표 개수',
  'mean sentence eojeols': '문장 평균 어절',
  'sentence eojeol CV': '문장 어절 CV',
  'comma per sentence': '문장당 쉼표',
  'suffix matched count': '어미 일치 개수',
  'suffix class diversity': '어미 부류 다양성',
  'suffix diversity': '어미 다양성',
};

// Flat presentation-string catalog. `{name}` placeholders are filled by t().
const STRINGS = {
  en: {
    'nav.github': 'GitHub',
    'nav.ethics': 'Ethics',
    'nav.benchmark': 'Benchmark',
    'ui.interfaceLanguage': 'Interface language',

    'hero.title': 'Paste text. See where it sounds packaged.',
    'hero.star': 'Star on GitHub',
    'hero.install': 'Install CLI',

    'cmd.copy': 'Copy',
    'cmd.copied': 'Copied',
    'stat.langs.label': 'Languages',
    'stat.langs.value': 'KO · EN · ZH · JA',
    'stat.patterns.label': 'Patterns',
    'stat.patterns.value': '~160 catalogued',
    'stat.signals.label': 'Signals',
    'stat.signals.value': '4 deterministic',
    'stat.local.label': 'Privacy',
    'stat.local.value': '100% local',

    'gallery.eyebrow': 'samples',
    'gallery.title': 'Before / after, side by side',
    'gallery.quiet': 'Curated AI drafts and the cleaner versions beside them. The playground audits signals; it does not rewrite — these edits are illustrative.',
    'gallery.before': 'Before · AI draft',
    'gallery.after': 'After · cleaner',
    'gallery.signal': 'AI signal',
    'gallery.audit': 'Audit this',
    'tool.eyebrow': 'try it',
    'tool.title': 'Audit your own text',

    'input.eyebrow': 'input',
    'input.title': 'Text to audit',
    'input.language': 'Language',
    'input.textareaLabel': 'Text to audit',
    'lang.ko': 'Korean',
    'lang.en': 'English',
    'lang.zh': 'Chinese',
    'lang.ja': 'Japanese',
    'btn.run': 'Run audit',
    'btn.sample': 'Load sample',
    'btn.openCli': 'Open in CLI',

    'score.eyebrow': 'score',
    'score.title': 'AI-likeness signal',
    'score.meterLabel': 'AI-likeness score out of 100',
    'cta.useful': 'Useful signal?',
    'cta.body': 'Star patina on GitHub so more writers find the audit.',
    'cta.star': 'Star / view source',
    'cli.title': 'Copied by “Open in CLI”',
    'cli.tag': 'local audit',

    'summary.review': '<strong>{hot}</strong> / {total} paragraphs marked for review',
    'summary.tokens': '<strong>{tokens}</strong> deterministic tokens checked',
    'summary.disclaimer': 'Score is an editing signal, not an authorship verdict.',

    'audit.eyebrow': 'audit',
    'audit.title': 'Deterministic signals',
    'audit.quiet': 'Burstiness, MATTR, AI-favored lexicon density, and Korean rhythm diagnostics.',
    'audit.empty': 'No audit rows yet.',
    'audit.th.para': 'Para',
    'audit.th.status': 'Status',
    'audit.th.sent': 'Sent',
    'audit.th.tokens': 'Tokens',
    'audit.th.burst': 'Burst',
    'audit.th.mattr': 'MATTR',
    'audit.th.lexicon': 'Lexicon',
    'audit.th.signals': 'Signals',
    'pill.review': 'review',
    'pill.ok': 'ok',
    'value.na': 'n/a',
    'value.none': '—',

    'advisory.eyebrow': 'advisory',
    'advisory.title': 'Korean editing hints',
    'advisory.quiet':
      'Translationese and koPostEditese metadata are advisory-only revision hints; they never change score, hotspots, or audit rows.',
    'advisory.unavailable':
      'Korean advisory metadata is unavailable for this language. This panel is separate from scoring, hotspots, and audit diff rendering.',
    'advisory.translationeseTitle': 'Translationese hints',
    'advisory.translationeseQuiet':
      'Advisory-only Korean calque metadata for revision. It does not affect score, hot paragraphs, or audit rows.',
    'advisory.count': 'Count',
    'advisory.density': 'Density',
    'advisory.sentences': 'Sentences',
    'advisory.noRules':
      'No Korean translationese rules surfaced. Treat this as an editing hint, not a score input.',
    'advisory.example': 'Example:',
    'advisory.samples': 'Samples:',
    'advisory.ruleCount': 'count {count}',
    'advisory.strong': 'strong',
    'advisory.translationeseRule': 'Translationese rule',
    'advisory.koPeTitle': 'Korean post-editese metadata',
    'advisory.koPeSkipped':
      'Schema <code>{schema}</code> skipped: {reason}. Advisory metadata is unavailable for this input.',
    'advisory.koPeAnalyzed':
      'Schema <code>{schema}</code> analyzed as editing guidance only.',
    'advisory.paragraphs': 'Paragraphs',
    'advisory.eojeols': 'Eojeols',
    'advisory.th.group': 'Group',
    'advisory.th.metric': 'Metric',
    'advisory.th.value': 'Value',

    'diff.eyebrow': 'diff',
    'diff.title': 'Suspect-zone diff',
    'diff.report': 'Report false positive',
    'diff.quiet':
      'v1 highlights review zones and lexicon hits only. No rewrite. Human text wrongly flagged? The report button pre-fills a GitHub issue with the flagged text and signals — nothing is sent unless you submit it.',
    'diff.empty': 'Paste text to see suspect zones. v1 does not rewrite.',
    'diff.noHotspot': 'No deterministic hotspot in this paragraph.',
    'diff.lexiconHits': 'Lexicon hits:',

    'footer.text':
      'Scores measure editing hotspots, not authorship. Pasted text stays in your browser; Vercel Web Analytics records page-view metadata only.',
    'footer.ethics': 'Read the ethics note.',

    'status.copied': 'Copied CLI command.',
    'status.copyFailed': 'Copy failed; select the command below.',
    'status.reportFirst': 'Paste text and run the audit first, then report the false positive.',
    'status.reportOpened':
      'Opened a pre-filled GitHub report — review it, then submit. Your text only leaves the browser if you submit.',
    'status.reportBlocked':
      'Pop-up blocked. Allow pop-ups, or open an issue from the GitHub link in the header.',
  },
  ko: {
    'nav.github': 'GitHub',
    'nav.ethics': '윤리',
    'nav.benchmark': '벤치마크',
    'ui.interfaceLanguage': '인터페이스 언어',

    'hero.title': '텍스트를 붙여넣고, 어디가 포장된 느낌인지 확인하세요.',
    'hero.star': 'GitHub에서 별 주기',
    'hero.install': 'CLI 설치',

    'cmd.copy': '복사',
    'cmd.copied': '복사됨',
    'stat.langs.label': '언어',
    'stat.langs.value': '한국어 · 영어 · 중국어 · 일본어',
    'stat.patterns.label': '패턴',
    'stat.patterns.value': '약 160종 수록',
    'stat.signals.label': '신호',
    'stat.signals.value': '결정론적 4종',
    'stat.local.label': '프라이버시',
    'stat.local.value': '100% 로컬',

    'gallery.eyebrow': '샘플',
    'gallery.title': '원문과 정리본 나란히',
    'gallery.quiet': '큐레이션한 AI 초안과 그 옆의 정리본입니다. 플레이그라운드는 신호를 감사할 뿐 다시 쓰지 않습니다 — 이 정리본은 예시입니다.',
    'gallery.before': '원문 · AI 초안',
    'gallery.after': '정리본 · 더 담백하게',
    'gallery.signal': 'AI 신호',
    'gallery.audit': '이 글 감사하기',
    'tool.eyebrow': '직접 해보기',
    'tool.title': '직접 쓴 글 감사하기',

    'input.eyebrow': '입력',
    'input.title': '감사할 텍스트',
    'input.language': '언어',
    'input.textareaLabel': '감사할 텍스트',
    'lang.ko': '한국어',
    'lang.en': '영어',
    'lang.zh': '중국어',
    'lang.ja': '일본어',
    'btn.run': '감사 실행',
    'btn.sample': '샘플 불러오기',
    'btn.openCli': 'CLI로 열기',

    'score.eyebrow': '점수',
    'score.title': 'AI 유사도 신호',
    'score.meterLabel': '100점 만점 AI 유사도 점수',
    'cta.useful': '유용한 신호인가요?',
    'cta.body': 'GitHub에서 patina에 별을 주면 더 많은 작성자가 이 감사를 발견합니다.',
    'cta.star': '별 주기 / 소스 보기',
    'cli.title': '“CLI로 열기”로 복사됨',
    'cli.tag': '로컬 감사',

    'summary.review': '<strong>{hot}</strong> / {total} 문단이 검토 대상으로 표시됨',
    'summary.tokens': '<strong>{tokens}</strong>개 결정론적 토큰 점검됨',
    'summary.disclaimer': '점수는 편집 신호일 뿐, 저작자 판정이 아닙니다.',

    'audit.eyebrow': '감사',
    'audit.title': '결정론적 신호',
    'audit.quiet': '버스트성, MATTR, AI 선호 어휘 밀도, 한국어 리듬 진단.',
    'audit.empty': '아직 감사 행이 없습니다.',
    'audit.th.para': '문단',
    'audit.th.status': '상태',
    'audit.th.sent': '문장',
    'audit.th.tokens': '토큰',
    'audit.th.burst': '버스트',
    'audit.th.mattr': 'MATTR',
    'audit.th.lexicon': '어휘',
    'audit.th.signals': '신호',
    'pill.review': '검토',
    'pill.ok': '양호',
    'value.na': '해당없음',
    'value.none': '—',

    'advisory.eyebrow': '참고',
    'advisory.title': '한국어 편집 힌트',
    'advisory.quiet':
      '번역투(Translationese)와 koPostEditese 메타데이터는 참고용 교정 힌트일 뿐, 점수·핫스팟·감사 행을 바꾸지 않습니다.',
    'advisory.unavailable':
      '이 언어에서는 한국어 참고 메타데이터를 제공하지 않습니다. 이 패널은 점수·핫스팟·감사 diff 렌더링과 분리되어 있습니다.',
    'advisory.translationeseTitle': '번역투 힌트',
    'advisory.translationeseQuiet':
      '교정용 한국어 번역투(칼크) 메타데이터(참고용). 점수·핫 문단·감사 행에는 영향을 주지 않습니다.',
    'advisory.count': '개수',
    'advisory.density': '밀도',
    'advisory.sentences': '문장 수',
    'advisory.noRules': '드러난 한국어 번역투 규칙이 없습니다. 점수 입력이 아니라 편집 힌트로만 참고하세요.',
    'advisory.example': '예시:',
    'advisory.samples': '샘플:',
    'advisory.ruleCount': '개수 {count}',
    'advisory.strong': '강함',
    'advisory.translationeseRule': '번역투 규칙',
    'advisory.koPeTitle': '한국어 포스트에디팅 메타데이터',
    'advisory.koPeSkipped':
      '스키마 <code>{schema}</code> 건너뜀: {reason}. 이 입력에 대한 참고 메타데이터가 없습니다.',
    'advisory.koPeAnalyzed': '스키마 <code>{schema}</code> 분석됨 — 편집 가이드 용도로만 사용하세요.',
    'advisory.paragraphs': '문단 수',
    'advisory.eojeols': '어절 수',
    'advisory.th.group': '그룹',
    'advisory.th.metric': '지표',
    'advisory.th.value': '값',

    'diff.eyebrow': 'diff',
    'diff.title': '의심 구간 diff',
    'diff.report': '오탐 신고',
    'diff.quiet':
      'v1은 검토 구간과 어휘 적중만 강조합니다. 다시 쓰지 않습니다. 사람이 쓴 글이 잘못 표시되었나요? 신고 버튼은 표시된 텍스트와 신호로 GitHub 이슈를 미리 채워 줍니다 — 제출하지 않으면 아무것도 전송되지 않습니다.',
    'diff.empty': '텍스트를 붙여넣으면 의심 구간이 보입니다. v1은 다시 쓰지 않습니다.',
    'diff.noHotspot': '이 문단에는 결정론적 핫스팟이 없습니다.',
    'diff.lexiconHits': '어휘 적중:',

    'footer.text':
      '점수는 저작자가 아니라 편집 핫스팟을 측정합니다. 붙여넣은 텍스트는 브라우저에 남아 있으며, Vercel 웹 애널리틱스는 페이지뷰 메타데이터만 기록합니다.',
    'footer.ethics': '윤리 안내 읽기.',

    'status.copied': 'CLI 명령을 복사했습니다.',
    'status.copyFailed': '복사 실패 — 아래 명령을 직접 선택하세요.',
    'status.reportFirst': '먼저 텍스트를 붙여넣고 감사를 실행한 뒤 오탐을 신고하세요.',
    'status.reportOpened':
      '미리 채워진 GitHub 신고를 열었습니다 — 검토 후 제출하세요. 제출해야만 텍스트가 브라우저를 벗어납니다.',
    'status.reportBlocked': '팝업이 차단되었습니다. 팝업을 허용하거나 헤더의 GitHub 링크에서 이슈를 여세요.',
  },
};

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

// Translate a presentation key. Falls back to English, then to the key itself,
// so a missing key is visible but never throws or renders "undefined".
export function t(uiLang, key, vars) {
  const lang = normalizeUiLang(uiLang);
  const template = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return interpolate(template, vars);
}

export function bandLabel(uiLang, bandKey) {
  const lang = normalizeUiLang(uiLang);
  return BAND[lang]?.[bandKey] ?? BAND.en[bandKey] ?? bandKey;
}

export function reasonLabel(uiLang, code) {
  const lang = normalizeUiLang(uiLang);
  return REASON_LABELS[lang]?.[code] ?? REASON_LABELS.en[code] ?? code;
}

export function reasonDetail(uiLang, code, vars = {}) {
  const lang = normalizeUiLang(uiLang);
  const builder = REASON_DETAILS[lang]?.[code] ?? REASON_DETAILS.en[code];
  return builder ? builder(vars) : '';
}

export function koPeGroupLabel(uiLang, group) {
  return normalizeUiLang(uiLang) === 'ko' ? KO_PE_GROUP[group] ?? group : group;
}

export function koPeMetricLabel(uiLang, label) {
  return normalizeUiLang(uiLang) === 'ko' ? KO_PE_METRIC[label] ?? label : label;
}

// Test/diagnostic helper: the flat presentation-string keys for a UI language.
// Used to guard that every English key has a Korean translation (and vice versa).
export function localeKeys(uiLang) {
  return Object.keys(STRINGS[normalizeUiLang(uiLang)] ?? {});
}
