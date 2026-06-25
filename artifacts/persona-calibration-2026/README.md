# Persona calibration corpus (2026)

patina 페르소나 개편(특히 한국어 보이스-합성 하네스)을 위한 근거 코퍼스. "사람들이 AI가 쓴 것 같다고 싫어하는" 패턴을 실제 글에서 수집·측정한 자료다.

## 저작권/프라이버시 정책
- 외부 글 **원문/HTML(raw)·파생 rewrite(fixtures)·비교 HTML은 커밋하지 않는다**(`raw/`, `*.private.*`, `fixtures*.jsonl` = dir-local `.gitignore`).
- 추적 대상은 **메타데이터 + 짧은 verbatim 인용(fair use) + 출처 URL + sha256**.
- 재현: `sources.jsonl`의 URL을 다시 수집해 raw sha256을 대조.

## 구성
| 파일 | 추적 | 내용 |
|---|---|---|
| `sources.jsonl` | ✓ | AI-의심 KO 블로그 샘플 메타(URL·register·label·sha256). raw는 `raw/`(ignored). |
| `ai-tells-catalog.md` | ✓ | 사람들이 싫어하는 AI 티 카탈로그(EN/KO) + EN/X 보강. |
| `calibration-round1.json` | ✓ | Round 1 결정론 측정(persona_match·churn, baseline vs persona). |
| `sycophancy-corpus.jsonl` | ✓ | 아첨/glazing 예시 **258개**(en 176·ko 55·ja 15·zh 12), 12개 플랫폼. |
| `sycophancy-terms.json` | ✓ | 위 코퍼스에서 추출한 측정용 문구 161개. |
| `sycophancy-corpus.md` | ✓ | 아첨 코퍼스 읽기용 요약(플랫폼 카운트·예시·출처). |
| `sycophancy/*.jsonl,*.notes.md` | ✓ | 원천별 수집(x·reddit-hn·korean·press·video·linkedin-academic·korean2·ja-zh). |
| `affirmation-terms.json` | ✓ | 자기계발/affirmation 측정용 용어 30개. |
| `raw/`, `*.private.*`, `fixtures*.jsonl` | ✗ ignored | 원문/HTML, rewrite 산출물, 비교 HTML. |

## 핵심 발견 (요약)
- patina 결정론 탐지는 실제 AI-의심 KO 글을 거의 못 잡음(3개 중 2개 doc.hot=false, 극단 AI글도 lexicon 0).
- 웰니스/hype 포장은 페르소나(`natural-ko`)로 깔끔히 제거(어휘 10→0); 레거시 `--restyle voice`는 절반(10→6).
- "아첨/affirmation"은 두 축: (a) 사용자 치켜세우기 아첨(채팅, 제거 대상 — 본 코퍼스) (b) 자기계발 affirmation 장르(콘텐츠 자체 → 장르 유지, 비목표).
- 아첨은 EN/KO/JA/ZH 공통(번역체 직역): "You're absolutely right" / "예리하십니다" / 「鋭いご指摘」 / "见解/深刻".
