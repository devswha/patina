# False-positive Gallery

Patina is an editing signal, not an authorship detector. A high score means "this passage contains signals that often make text read AI-like"; it does not prove that a person did not write it.

The examples below are safe, redistributable false-positive **risk** examples. They avoid private people, real accusations, and proprietary text. Use them to decide whether to soften a pattern, add an exclusion, or lower severity for a register.

## 1. Encyclopedic register

> The observatory opened to the public in 1912 and was expanded twice before the end of the decade. Its main dome housed a refracting telescope, while the east wing contained classrooms, storage cabinets, and a small photographic darkroom. Local newspapers described the building as a civic improvement rather than a research facility.

**Why it may be flagged:** encyclopedic prose often has low emotional texture, compact factual density, and repeated institutional nouns.

**How to read the score:** check whether the passage is merely neutral and factual. Do not rewrite it into first-person voice just to lower a score.

## 2. Academic Korean `~다` prose

> 본 연구는 지역 기록물의 분류 기준이 검색 정확도에 미치는 영향을 검토한다. 분석 대상은 2010년부터 2020년까지 생산된 공개 행정 문서 240건이다. 문서 유형, 발행 기관, 보존 기간을 독립 변수로 설정하고, 검색 실패 사례를 오류 유형별로 분류하였다.

**Why it may be flagged:** Korean academic prose naturally uses `~다` endings, abstract nouns, and regular sentence cadence. Those are also signals Patina watches in generic AI prose.

**How to read the score:** for academic/register-bound prose, treat highlighted phrases as review prompts. Preserve the required formal ending style unless the target publication permits a different register.

## 3. Legal or compliance policy

> Employees must retain expense records for five years after the reimbursement date. Requests submitted without a receipt may be approved only when the department head confirms that the expense was necessary, reasonable, and incurred on behalf of the organization.

**Why it may be flagged:** policy text repeats obligations, uses modal verbs, and avoids personal voice. That can resemble templated AI output even when it is normal compliance drafting.

**How to read the score:** ask whether the wording is legally or operationally required. Prefer tightening ambiguity over adding casual language.

## 4. Corporate release note

> The update improves import reliability for large CSV files, adds retry logging for failed background jobs, and reduces memory use during preview generation. Administrators can enable the new queue setting from the workspace configuration page.

**Why it may be flagged:** release notes often stack benefits in parallel clauses and use product nouns repeatedly. The structure may look polished rather than personal.

**How to read the score:** keep exact feature names and behavior. If rewriting, reduce vague praise; do not remove operational details.

## 5. Government report summary

> The program served 18 rural clinics during the reporting period. Most participating sites requested additional training on intake forms, referral tracking, and data-retention rules. The department will review those requests before the next grant cycle.

**Why it may be flagged:** report summaries use institutional subjects, measured claims, and cautious future-tense commitments. That register is intentionally restrained.

**How to read the score:** check for over-smoothing, but do not punish public-sector caution or required measurement language.

## 6. CJK punctuation cleanup that creates translationese

> 완전 자율, 무 TUI 세팅을 원한다면 자율 모드 플래그를 추가합니다.

**Why it may be flagged:** the source may contain real AI-like punctuation rhythm or calques, but a token-level fix can make Korean, Chinese, or Japanese worse. Replacing punctuation or isolated words without reading the sentence can create literal phrasing such as `무 TUI`.

**How to read the score:** treat the flagged punctuation as a prompt to rewrite the clause, not the mark. A safer Korean rewrite is `TUI 없이 완전 자율로 설치하려면 자율 모드 플래그를 추가하세요.` Preserve the condition and action while rebuilding the clause boundary.

## Reporting a false positive

Open a false-positive issue with:

1. language and register;
2. a safe sample you are allowed to share;
3. the Patina score or audit output;
4. why the passage should remain acceptable in that register;
5. whether the fix should be an exclusion, lower severity, profile override, or benchmark fixture.
