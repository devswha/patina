# Korean Pattern Reference

This page expands the Korean pattern packs into a browsable reference. It is generated from `patterns/ko-*.md`, so the numbers, names, watch words, fire conditions, and examples mirror the source pattern files.

- Rewrite-capable patterns: 32
- Score/audit-only viral-hook patterns: 5
- Main selector: [PATTERNS.md](PATTERNS.md)

## Pattern Index

| # | Type | Pattern | Source |
|---|------|---------|--------|
| 1 | rewrite | 과도한 중요성 부여 | [ko-content.md](../patterns/ko-content.md) |
| 2 | rewrite | 과도한 주목도/미디어 언급 | [ko-content.md](../patterns/ko-content.md) |
| 3 | rewrite | ~하며/~하고 피상적 분석 | [ko-content.md](../patterns/ko-content.md) |
| 4 | rewrite | 홍보성/광고성 언어 | [ko-content.md](../patterns/ko-content.md) |
| 5 | rewrite | 모호한 출처 인용 | [ko-content.md](../patterns/ko-content.md) |
| 6 | rewrite | 틀에 박힌 "과제와 전망" 섹션 | [ko-content.md](../patterns/ko-content.md) |
| 7 | rewrite | AI 특유 어휘 남발 | [ko-language.md](../patterns/ko-language.md) |
| 8 | rewrite | ~적(的) 접미사 남발 | [ko-language.md](../patterns/ko-language.md) |
| 9 | rewrite | 부정 병렬구조 | [ko-language.md](../patterns/ko-language.md) |
| 10 | rewrite | 3의 법칙 남발 | [ko-language.md](../patterns/ko-language.md) |
| 11 | rewrite | 유의어 순환 | [ko-language.md](../patterns/ko-language.md) |
| 12 | rewrite | ~에 있어서/~함에 있어 장황한 조사 사용 | [ko-language.md](../patterns/ko-language.md) |
| 32 | rewrite | "보다" 비교부사 남용 | [ko-language.md](../patterns/ko-language.md) |
| 13 | rewrite | 과도한 연결 표현 | [ko-style.md](../patterns/ko-style.md) |
| 14 | rewrite | 볼드체 남발 | [ko-style.md](../patterns/ko-style.md) |
| 15 | rewrite | 인라인 헤더 목록 | [ko-style.md](../patterns/ko-style.md) |
| 16 | rewrite | ~고 있다 진행형 남발 | [ko-style.md](../patterns/ko-style.md) |
| 17 | rewrite | 이모지 | [ko-style.md](../patterns/ko-style.md) |
| 18 | rewrite | 과도한 한자어/공식어 사용 | [ko-style.md](../patterns/ko-style.md) |
| 19 | rewrite | 챗봇 표현 | [ko-communication.md](../patterns/ko-communication.md) |
| 20 | rewrite | 학습 데이터 기한 면책 | [ko-communication.md](../patterns/ko-communication.md) |
| 21 | rewrite | 아첨하는 말투 | [ko-communication.md](../patterns/ko-communication.md) |
| 29 | rewrite | 거짓 뉘앙스 (소급적 재해석) | [ko-communication.md](../patterns/ko-communication.md) |
| 22 | rewrite | 채움 표현 | [ko-filler.md](../patterns/ko-filler.md) |
| 23 | rewrite | 과도한 헤징 | [ko-filler.md](../patterns/ko-filler.md) |
| 24 | rewrite | 막연한 긍정적 결론 | [ko-filler.md](../patterns/ko-filler.md) |
| 31 | rewrite | 결론 신호어 남용 | [ko-filler.md](../patterns/ko-filler.md) |
| 25 | rewrite | 구조적 반복 | [ko-structure.md](../patterns/ko-structure.md) |
| 26 | rewrite | 번역체 | [ko-structure.md](../patterns/ko-structure.md) |
| 27 | rewrite | 수동태 남용 | [ko-structure.md](../patterns/ko-structure.md) |
| 28 | rewrite | 불필요한 외래어 남발 | [ko-structure.md](../patterns/ko-structure.md) |
| 30 | rewrite | 수사적 질문 단락 시작 | [ko-structure.md](../patterns/ko-structure.md) |
| VH-1 | score/audit only | 숫자 충격 훅 | [ko-viral-hook.md](../patterns/ko-viral-hook.md) |
| VH-2 | score/audit only | 클릭베이트 미스터리 종결 | [ko-viral-hook.md](../patterns/ko-viral-hook.md) |
| VH-3 | score/audit only | 검증 회피 단언 | [ko-viral-hook.md](../patterns/ko-viral-hook.md) |
| VH-4 | score/audit only | 호흡 최적화 단문 배열 | [ko-viral-hook.md](../patterns/ko-viral-hook.md) |
| VH-5 | score/audit only | AI 인플루언서 어휘 | [ko-viral-hook.md](../patterns/ko-viral-hook.md) |

## 콘텐츠 패턴

### 1. 과도한 중요성 부여

- Source: [ko-content.md](../patterns/ko-content.md)
- Type: rewrite-capable pattern
- Watch words: ~의 핵심적/중추적/획기적인 역할, ~에 있어 중대한 의의, ~의 위상을 드높이다, ~의 토대를 마련하다, 패러다임의 전환, ~라는 점에서 의의가 크다, ~의 이정표, 전환점을 맞이하다, 새로운 지평을 열다, ~의 발자취
- Fire condition: 같은 문단에 주의 어휘가 2개 이상 등장하거나, "획기적", "전환점" 같은 강한 표현이 일상적 사건·제품에 적용된 경우.
- Example files: [failure](../examples/01-failure-01.md) · [success](../examples/01-success-01.md)

Example before:

> 한국 반도체 산업의 발전은 대한민국 경제 성장에 있어 핵심적인 역할을 했으며, 이는 국가 산업의 획기적인 전환점을 의미한다. 이러한 성과는 글로벌 기술 경쟁에서 대한민국의 위상을 드높이는 데 크게 기여하였다.

Example after:

> 삼성전자가 64K DRAM을 만든 게 1983년이다. 40년 지난 지금 한국이 메모리 반도체 시장의 60%를 갖고 있다.

### 2. 과도한 주목도/미디어 언급

- Source: [ko-content.md](../patterns/ko-content.md)
- Type: rewrite-capable pattern
- Watch words: 국내외 언론의 주목을 받다, ~에서 크게 보도되다, 세계적인 미디어의 관심, 활발한 활동을 이어가다
- Fire condition: 구체적 매체명·기사 제목·날짜 없이 광범위한 주목·보도를 주장하는 경우. 매체명이 있더라도 맥락 없이 나열만 한 경우.
- Example files: [failure](../examples/02-failure-01.md) · [success](../examples/02-success-01.md)

Example before:

> 그의 작품은 뉴욕타임스, BBC, 르몽드 등 세계적인 언론 매체에서 주목을 받았으며, 국내외에서 활발한 활동을 이어가고 있다.

Example after:

> 뉴욕타임스는 2023년 기사에서 그의 작품을 "한국 현대미술의 새로운 흐름"으로 소개했다.

### 3. ~하며/~하고 피상적 분석

- Source: [ko-content.md](../patterns/ko-content.md)
- Type: rewrite-capable pattern
- Watch words: ~을 보여주며, ~을 상징하고, ~에 기여하며, ~을 촉진하고, ~을 도모하며, ~의 장을 마련하고
- Fire condition: 한 문장 또는 연속 절에 "~하며/~하고" 연결형이 3개 이상 나열되면서, 구체적 인과 설명 없이 나열만 한 경우.
- Example files: [failure](../examples/03-failure-01.md) · [success](../examples/03-success-01.md)

Example before:

> 이 축제는 지역 문화의 다양성을 보여주며, 전통과 현대의 조화를 상징하고, 지역 경제 활성화에 기여하며, 세대 간 소통의 장을 마련하고 있다.

Example after:

> 축제에는 매년 약 50만 명이 방문하며, 기간 중 지역 상권 매출이 평소보다 30% 늘어난다.

### 4. 홍보성/광고성 언어

- Source: [ko-content.md](../patterns/ko-content.md)
- Type: rewrite-capable pattern
- Watch words: 수려한, 빼어난, 풍부한, 활기찬, 역동적인, ~의 보석, ~의 자랑, ~의 메카, 감동적인, 매혹적인, 아름다운, 잊을 수 없는, 가슴 뛰는, 숨막히는, 경이로운
- Fire condition: 같은 대상에 홍보성 형용사가 2개 이상 붙거나, "~의 보석", "숨막히는" 같은 강한 수식어가 서술문(광고 인용이 아닌 본문)에 사용된 경우.
- Example files: [failure](../examples/04-failure-01.md) · [success](../examples/04-success-01.md)

Example before:

> 제주도는 수려한 자연경관과 풍부한 문화유산이 조화를 이루는 아름다운 섬으로, 대한민국 관광의 보석이라 할 수 있다. 이곳의 매혹적인 풍경은 방문객들에게 잊을 수 없는 감동을 선사한다.

Example after:

> 제주도에는 한라산이랑 오름이 360개 정도 있다. 연간 1,500만 명이 온다. 사람이 너무 많아서 입장 제한을 거는 곳도 늘고 있다.

### 5. 모호한 출처 인용

- Source: [ko-content.md](../patterns/ko-content.md)
- Type: rewrite-capable pattern
- Watch words: 전문가들은, 업계 관계자에 따르면, 학계에서는, 일각에서는, 관련 연구에 따르면 (구체적 연구 없이)
- Fire condition: 출처가 인명·기관·발표 날짜 없이 "전문가들", "업계 관계자", "관련 연구" 같은 익명 권위로만 제시된 경우.
- Example files: [failure](../examples/05-failure-01.md) · [success](../examples/05-success-01.md)

Example before:

> 전문가들은 이 기술이 향후 산업 전반에 걸쳐 혁신적인 변화를 가져올 것으로 전망하고 있다. 업계 관계자에 따르면, 시장 규모는 지속적으로 성장할 것으로 예상된다.

Example after:

> 한국전자통신연구원(ETRI)의 2024년 보고서에 따르면, 국내 AI 반도체 시장은 2027년까지 연평균 25% 성장이 예상된다.

### 6. 틀에 박힌 "과제와 전망" 섹션

- Source: [ko-content.md](../patterns/ko-content.md)
- Type: rewrite-capable pattern
- Watch words: ~에도 불구하고 여전히 많은 과제가, 이러한 과제에도 불구하고, ~을 통해 극복해 나갈 것으로, 밝은 전망이 기대된다, 오늘날 급변하는 시대에, 최근 들어 ~이/가 급격히 변화하고 있다, ~의 시대가 도래하면서, 21세기 들어, 4차 산업혁명 시대를 맞이하여
- Fire condition: 같은 문단이나 결론부에 모호한 과제 표현("여전히 많은 과제가")과 모호한 낙관 표현("밝은 전망이 기대된다")이 함께 등장하는 경우. 또는 도입부가 "오늘날 급변하는 ~", "4차 산업혁명 시대를 맞이하여" 같은 시대 공식으로 시작하는 경우.
- Example files: [failure](../examples/06-failure-01.md) · [success](../examples/06-success-01.md)

Example before:

> 이러한 성과에도 불구하고 여전히 많은 과제가 남아 있다. 하지만 이러한 과제에도 불구하고, 지속적인 노력과 혁신을 통해 밝은 미래를 기대할 수 있다.

Example after:

> 2023년 감사원 보고서는 인력 부족과 예산 집행률 저조를 주요 문제로 지적했다. 시는 2024년 예산을 15% 늘리고 전문 인력 30명을 채용할 계획이다.

## 언어/문법 패턴

### 7. AI 특유 어휘 남발

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: 다양한, 활발한, 주목할 만한, 혁신적인, 체계적인, 지속적인, 효과적인, 적극적인, 심층적인, 유기적인, 종합적인, 선도적인, 아울러, 나아가, 이를 통해, 이러한 맥락에서, 도모하다, 촉진하다, 극대화하다
- Fire condition: 한 문단에 고빈도 AI 어휘가 3개 이상 등장하는 경우.
- Example files: [failure](../examples/07-failure-01.md) · [success](../examples/07-success-01.md)

Example before:

> 아울러, 다양한 혁신적인 기술들이 활발하게 개발되고 있으며, 이를 통해 체계적이고 효과적인 솔루션을 제공하고 있다. 나아가, 이러한 지속적인 노력은 주목할 만한 성과를 거두고 있다.

Example after:

> 올해 나온 기술 중에는 배터리 수명을 20% 늘린 전력 관리 칩과, 처리 속도가 기존보다 두 배 빠른 NPU가 있다.

### 8. ~적(的) 접미사 남발

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: 혁신적, 체계적, 효과적, 효율적, 선도적, 진취적, 종합적, 핵심적, 전략적, 실질적, 근본적, 획기적
- Fire condition: 한 문장에 "~적" 형용사가 3개 이상 등장하거나, 연속 2문장에 걸쳐 4개 이상 사용된 경우.
- Example files: [failure](../examples/08-failure-01.md) · [success](../examples/08-success-01.md)

Example before:

> 혁신적이고 체계적인 접근 방식을 통해, 효과적이고 효율적인 결과를 도출하며, 선도적이고 진취적인 자세로 종합적인 발전을 추구하고 있다.

Example after:

> 팀은 기존 프로세스를 단순화하고, 불필요한 승인 단계를 빼서 배포 시간을 절반으로 줄였다.

### 9. 부정 병렬구조

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: ~에 그치지 않고, ~뿐만 아니라 ~도, 비단 ~뿐 아니라, ~을 넘어
- Fire condition: 같은 문서에 "~뿐만 아니라", "~에 그치지 않고" 등의 부정 병렬 구조가 2회 이상 등장하거나, 긍정 서술만으로 더 간결하게 표현할 수 있는 곳에 단일 사용된 경우.
- Example files: [failure](../examples/09-failure-01.md) · [success](../examples/09-success-01.md)

Example before:

> 이것은 단순한 기술 발전에 그치지 않고, 우리 사회 전반에 걸친 근본적인 변화를 의미한다. 이는 비단 경제적 측면뿐만 아니라, 사회적·문화적 측면에서도 중대한 함의를 지닌다.

Example after:

> 이 기술은 처음에 제조 공정에 적용됐고, 이후 물류와 고객 서비스에도 쓰이기 시작했다.

### 10. 3의 법칙 남발

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 같은 문서에 3개 항목 나열이 2회 이상 등장하거나, 셋으로 묶은 근거가 자의적이어서 다른 개수도 동등하게 성립하는 경우.
- Example files: [failure](../examples/10-failure-01.md) · [success](../examples/10-success-01.md)

Example before:

> 이 프로그램은 창의성, 혁신성, 그리고 지속가능성을 추구합니다. 참가자들은 영감, 통찰, 그리고 실질적인 경험을 얻을 수 있습니다.

Example after:

> 이 프로그램은 실무 프로젝트 중심으로 운영되며, 참가자들은 8주간 실제 제품 개발에 참여한다.

### 11. 유의어 순환

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 같은 문단에서 동일 대상이 3개 이상의 다른 명칭·동의어로 지칭되는 경우.
- Example files: [failure](../examples/11-failure-01.md) · [success](../examples/11-success-01.md)

Example before:

> 이 도시는 많은 관광객을 끌어모으고 있다. 이 지역은 다양한 문화 행사로 유명하다. 해당 지자체는 관광 인프라를 확충 중이다. 이곳은 연간 방문객이 100만 명에 달한다.

Example after:

> 이 도시에는 연간 100만 명이 방문한다. 문화 행사가 많고, 시는 관광 인프라에 500억 원을 투자하고 있다.

### 12. ~에 있어서/~함에 있어 장황한 조사 사용

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: ~에 있어서, ~함에 있어, ~(으)로서, ~(이)라는 점에서, ~의 관점에서 볼 때
- Fire condition: 같은 문단에 장황한 조사 표현이 2개 이상 등장하거나, "~에서"로 충분한 곳에 "~에 있어서"가 사용된 경우.
- Example files: [failure](../examples/12-failure-01.md) · [success](../examples/12-success-01.md)

Example before:

> 교육에 있어서 가장 중요한 것은 학생들의 참여를 이끌어 내는 것이며, 이를 달성함에 있어 교사의 역할이 핵심적이다. 학습 효과를 극대화함에 있어서는 개별화된 접근이 필요하다.

Example after:

> 교육에서 가장 중요한 것은 학생 참여다. 교사들은 학생별로 다른 과제를 내는 방식을 시도하고 있다.

### 32. "보다" 비교부사 남용

- Source: [ko-language.md](../patterns/ko-language.md)
- Type: rewrite-capable pattern
- Watch words: 보다 + 형용사/부사 형태 — "보다 구체적인", "보다 효율적인", "보다 심도 있는", "보다 다양한", "보다 명확한", "보다 적극적인", "보다 체계적인", "보다 효과적인", "보다 신중한", "보다 폭넓은"
- Fire condition: 한 문서 안에 "보다 [형용사/부사 + 한]" 형태가 2회 이상 등장. 또는 한 단락 안에 "보다 X" 표현이 1회 등장하면서 같은 단락에 다른 격식체 마커("~을 위한", "~에 있어서", "~사료됩니다", "~할 것으로 보입니다")가 함께 있는 경우.
- Example files: [failure](../examples/32-failure-01.md) · [success](../examples/32-success-01.md)

Example before:

> 프로젝트 일정과 관련하여 보다 구체적인 마일스톤 설정이 필요할 것으로 보입니다. 예산 배분에 있어서도 보다 효율적인 운영 방안에 대한 검토가 이루어져야 할 것으로 사료됩니다. 가능하시다면 다음 주 중 보다 심도 있는 논의를 진행하는 것이 어떨까 싶습니다.

Example after:

> 프로젝트 일정에 더 구체적인 마일스톤이 있어야 할 것 같습니다. 예산 운영 방안도 한 번 점검이 필요해 보입니다. 다음 주에 자세히 이야기 나누면 좋겠습니다.

## 스타일 패턴

### 13. 과도한 연결 표현

- Source: [ko-style.md](../patterns/ko-style.md)
- Type: rewrite-capable pattern
- Watch words: 이를 통해, 이러한 점에서, 이러한 맥락에서, 한편, 또한, 더불어, 아울러, 이에 따라, 이와 관련하여, 이를 바탕으로
- Fire condition: 연속 3문장 이상에서 매 문장 앞에 연결 표현이 붙는 경우, 또는 같은 문단에 주의 어휘가 3개 이상 등장하는 경우.
- Example files: [failure](../examples/13-failure-01.md) · [success](../examples/13-success-01.md)

Example before:

> 이를 통해 기업의 경쟁력이 강화되었다. 이러한 점에서 이번 정책은 큰 의미를 지닌다. 한편, 일부에서는 우려의 목소리도 나오고 있다. 이러한 맥락에서 향후 정책 방향에 대한 논의가 필요하다.

Example after:

> 이번 정책 이후 수출 기업 10곳 중 7곳이 영업이익이 늘었다. 다만 중소기업연합회는 원자재 가격 상승 부담이 여전하다고 밝혔다.

### 14. 볼드체 남발

- Source: [ko-style.md](../patterns/ko-style.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 한 문단에 볼드 처리된 단어/구가 3개 이상이거나, 문서 전체에 5개 이상인 경우.
- Example files: [failure](../examples/14-failure-01.md) · [success](../examples/14-success-01.md)

Example before:

> **OKR(목표 및 핵심 결과)**, **KPI(핵심 성과 지표)**, 그리고 **BSC(균형 성과표)** 등 **다양한 성과 관리 프레임워크**를 통합적으로 활용합니다.

Example after:

> OKR, KPI, BSC 등 성과 관리 도구를 함께 활용한다.

### 15. 인라인 헤더 목록

- Source: [ko-style.md](../patterns/ko-style.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 같은 목록에 "**레이블:** 설명" 형식의 항목이 2개 이상인 경우.
- Example files: [failure](../examples/15-failure-01.md) · [success](../examples/15-success-01.md)

Example before:

> - **사용자 경험:** 새로운 인터페이스로 사용자 경험이 크게 개선되었습니다.
> - **성능:** 알고리즘 최적화를 통해 성능이 향상되었습니다.
> - **보안:** 종단간 암호화로 보안이 강화되었습니다.

Example after:

> 이번 업데이트는 인터페이스를 개선하고, 알고리즘 최적화로 속도를 높였으며, 종단간 암호화를 추가했다.

### 16. ~고 있다 진행형 남발

- Source: [ko-style.md](../patterns/ko-style.md)
- Type: rewrite-capable pattern
- Watch words: ~하고 있다, ~해 나가고 있다, ~을 추진하고 있다, ~을 이어가고 있다, ~에 박차를 가하고 있다
- Fire condition: 같은 문단에서 "~고 있다" 계열 진행형이 3회 이상 사용된 경우, 또는 연속 2문장이 모두 "~고 있다"로 끝나는 경우.
- Example files: [failure](../examples/16-failure-01.md) · [success](../examples/16-success-01.md)

Example before:

> 기업들은 새로운 시장을 개척하고 있으며, 기술 혁신을 추진하고 있고, 글로벌 파트너십을 확대하고 있다. 이를 통해 지속적인 성장을 이루어 나가고 있다.

Example after:

> 기업들은 올해 동남아 시장에 진출했고, 내년에는 유럽 진출을 계획 중이다.

### 17. 이모지

- Source: [ko-style.md](../patterns/ko-style.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 전문적·학술적·편집 텍스트에 이모지가 1개라도 등장하는 경우.
- Example files: [failure](../examples/17-failure-01.md) · [success](../examples/17-success-01.md)

Example before:

> 🚀 **출시 단계:** 제품은 3분기에 출시됩니다
> 💡 **핵심 인사이트:** 사용자는 단순함을 선호합니다
> ✅ **다음 단계:** 후속 미팅을 잡으세요

Example after:

> 제품은 3분기에 출시된다. 사용자 조사 결과 단순한 인터페이스를 선호했다. 다음 단계는 후속 미팅이다.

### 18. 과도한 한자어/공식어 사용

- Source: [ko-style.md](../patterns/ko-style.md)
- Type: rewrite-capable pattern
- Watch words: 도모하다, 기하다, 수립하다, 강구하다, 추진하다, 이행하다, 상기, 전술한, 본 사업, 관계 기관, 유기적, 복리 증진
- Fire condition: 같은 문단에 공식어·관료적 한자어가 3개 이상 등장하거나, "본 사업", "전술한", "상기" 같은 공문서 전용 표현이 일반 산문에 사용된 경우.
- Example files: [failure](../examples/18-failure-01.md) · [success](../examples/18-success-01.md)

Example before:

> 본 사업은 지역 경제 활성화 및 주민 복리 증진을 도모하기 위한 것으로, 관계 기관 간 유기적 협력 체계를 구축하여 효율적인 사업 추진을 기하고자 한다.

Example after:

> 이 사업은 지역 경제를 살리고 주민 생활을 개선하려는 것이다. 시청과 구청이 함께 진행한다.

## 소통 패턴

### 19. 챗봇 표현

- Source: [ko-communication.md](../patterns/ko-communication.md)
- Type: rewrite-capable pattern
- Watch words: 도움이 되셨으면 좋겠습니다, 궁금한 점이 있으시면 말씀해 주세요, ~에 대해 알아보겠습니다, ~를 정리해 드리겠습니다, 더 자세한 내용이 필요하시면
- Fire condition: 실시간 대화가 아닌 콘텐츠(기사, 보고서, 문서)에 챗봇 대화체 표현이 1개라도 등장하는 경우.
- Example files: [failure](../examples/19-failure-01.md) · [success](../examples/19-success-01.md)

Example before:

> 프랑스 혁명에 대해 정리해 드리겠습니다. 도움이 되셨으면 좋겠습니다! 더 자세한 내용이 필요하시면 말씀해 주세요.

Example after:

> 프랑스 혁명은 1789년 재정 위기와 식량 부족으로 시작되었다.

### 20. 학습 데이터 기한 면책

- Source: [ko-communication.md](../patterns/ko-communication.md)
- Type: rewrite-capable pattern
- Watch words: ~년 기준으로, 최신 정보와 다를 수 있습니다, 구체적인 정보는 제한적이나, 확인 가능한 자료에 따르면
- Fire condition: 편집·보도·분석 콘텐츠에 AI 학습 데이터 한계를 암시하는 자기 참조 또는 면책 표현이 1개라도 등장하는 경우.
- Example files: [failure](../examples/20-failure-01.md) · [success](../examples/20-success-01.md)

Example before:

> 이 회사의 설립 배경에 대한 구체적인 정보는 제한적이나, 확인 가능한 자료에 따르면 1990년대에 설립된 것으로 보입니다.

Example after:

> 이 회사는 1994년에 설립되었다(사업자등록 기준).

### 21. 아첨하는 말투

- Source: [ko-communication.md](../patterns/ko-communication.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 본론 앞에 아첨·비위 맞추기 표현이 1개라도 등장하는 경우.
- Example files: [failure](../examples/21-failure-01.md) · [success](../examples/21-success-01.md)

Example before:

> 좋은 질문이십니다! 정확하게 짚어주셨는데요, 이 주제는 정말 중요합니다. 경제적 요인에 대한 지적이 정말 탁월하십니다.

Example after:

> 말씀하신 경제적 요인이 여기서 중요하다.

### 29. 거짓 뉘앙스 (소급적 재해석)

- Source: [ko-communication.md](../patterns/ko-communication.md)
- Type: rewrite-capable pattern
- Watch words: 사실 좀 더 미묘한 문제인데, 정확하게 말하자면, 단순하게 말하긴 어렵지만, 물론 현실은 더 복잡한데, 보다 정확히 말하면, 공정하게 보자면, 좀 더 깊이 들어가면
- Fire condition: 앞선 주장을 새로운 증거·관점 없이 '미묘하다'는 프레이밍으로 바꿔 말하는 경우.

Example before:

> 재택근무는 생산성을 높입니다. 물론 이건 좀 더 미묘한 문제인데요, 재택근무가 특정 상황에서는 생산성을 높일 수 있지만 다른 상황에서는 어려움을 줄 수도 있고, 순효과는 조직 문화와 개인 업무 스타일에 따라 달라집니다.

Example after:

> 재택근무는 집중 작업에서 생산성을 높인다 — 스탠퍼드 연구에서 콜센터 직원 기준 13% 향상을 확인했다. 다만 즉흥적 협업에는 불리한데, 마이크로소프트 2021년 내부 데이터에 따르면 전면 재택 이후 팀 간 소통이 25% 줄었다.

## 채움/완화 패턴

### 22. 채움 표현

- Source: [ko-filler.md](../patterns/ko-filler.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 같은 문단에 채움 표현이 2개 이상 등장하거나, 삭제해도 의미가 전혀 변하지 않는 채움 표현이 단독으로 사용된 경우.
- Example files: [failure](../examples/22-failure-01.md) · [success](../examples/22-success-01.md)

Example transformations:

> - "이 목표를 달성하기 위해서는" → "이 목표를 이루려면"
> - "~라는 사실에 기인하여" → "~때문에"
> - "현 시점에서 볼 때" → "지금"
> - "~하는 경우에 한하여" → "~하면"
> - "~할 수 있는 능력을 보유하고 있다" → "~할 수 있다"
> - "주목할 만한 점은 ~라는 것이다" → 직접 서술

### 23. 과도한 헤징

- Source: [ko-filler.md](../patterns/ko-filler.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 하나의 주장에 한정·완화 표현("~수도 있다", "~것으로 보인다", "어느 정도", "일정 부분")이 3개 이상 중첩되거나, 반박 가능한 주장이 전혀 없을 정도로 헤징된 경우.
- Example files: [failure](../examples/23-failure-01.md) · [success](../examples/23-success-01.md)

Example before:

> 이 정책이 어느 정도의 효과를 가져올 수 있을 것으로 판단될 수도 있다는 점에서 일정 부분 긍정적인 측면이 있는 것으로 보입니다.

Example after:

> 이 정책은 효과가 있을 수 있다.

### 24. 막연한 긍정적 결론

- Source: [ko-filler.md](../patterns/ko-filler.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 같은 문단이나 결론부에 막연한 낙관 표현("밝은 미래가 기대된다", "새로운 도약", "흥미진진한 여정")이 2개 이상 등장하거나, 구체적 주장 없이 낙관 표현만으로 구성된 마무리 문장이 있는 경우.
- Example files: [failure](../examples/24-failure-01.md) · [success](../examples/24-success-01.md)

Example before:

> 앞으로 더욱 밝은 미래가 기대된다. 지속적인 발전과 혁신을 통해 새로운 도약을 이룰 것으로 전망된다. 흥미진진한 여정이 우리 앞에 펼쳐져 있다.

Example after:

> 회사는 내년에 매장 두 곳을 추가로 열 계획이다.

### 31. 결론 신호어 남용

- Source: [ko-filler.md](../patterns/ko-filler.md)
- Type: rewrite-capable pattern
- Watch words: 결론적으로, 결국, 궁극적으로, 요컨대, 종합하면, 종합해보면, 정리하면, 마지막으로
- Fire condition: 글의 마지막 문단(또는 마지막에서 두 번째 문단) 첫 문장이 위 신호어 중 하나로 시작. 또는 같은 문서에 결론 신호어가 2회 이상 등장.
- Example files: [failure](../examples/31-failure-01.md) · [success](../examples/31-success-01.md)

Example before:

> 결론적으로, 디지털 노마드 라이프스타일은 일시적인 유행이 아닌, 우리 사회 전반에 걸쳐 지속적으로 자리잡아갈 새로운 표준으로 자리매김하고 있다.

Example after:

> 디지털 노마드는 더 이상 유행이 아니다. 일하는 방식 하나가 바뀌었고, 사람들은 그 위에 새 일상을 짓고 있다.

## 구조 패턴

### 25. 구조적 반복

- Source: [ko-structure.md](../patterns/ko-structure.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 연속 3개 이상의 단락이 동일한 구조적 틀을 반복할 때. 예: 모든 단락이 "일반 진술 → 구체 사례/수치 → 의의/전망"으로 끝나는 경우. 또는 모든 단락이 "주제문 → 부연 → 요약" 동일 패턴.
- Example files: [failure](../examples/25-failure-01.md) · [success](../examples/25-success-01.md)

Example before:

> 한국의 반도체 산업은 1980년대부터 본격적으로 성장했다. 삼성전자는 1983년 64K DRAM 개발에 성공했으며, 이후 세계 시장에서 두각을 나타냈다. 이러한 성과는 한국 경제 발전의 중요한 토대가 되었다.
>
> 한국의 자동차 산업도 비약적인 발전을 이루었다. 현대자동차는 1976년 포니를 출시하며 국산 자동차 시대를 열었고, 현재 글로벌 5위권의 자동차 제조사로 성장했다. 이는 한국 제조업의 경쟁력을 보여주는 대표적인 사례이다.
>
> 한국의 조선 산업 역시 세계적인 수준에 도달했다. 현대중공업은 1972년 설립 이후 꾸준히 기술력을 축적했으며, 세계 최대 조선소로 자리매김했다. 이러한 발전은 한국의 산업 다각화에 크게 기여하였다.

Example after:

> 한국 반도체의 시작은 의외로 단순하다. 1983년, 삼성전자가 64K DRAM을 만들었다. 40년 뒤인 지금, 메모리 반도체 세계 시장의 60%가 한국 것이다.
>
> 자동차는 좀 다른 길을 걸었다. 현대차 포니가 1976년에 나왔을 때 아무도 진지하게 안 봤다. 솔직히 품질이 안 좋았으니까. 근데 지금은 글로벌 5위다.
>
> 조선은? 이건 거의 기적에 가깝다. 바다도 안 보이는 울산 벌판에 1972년 조선소를 세웠는데, 배 한 척 안 만들어 본 사람들이 시작했다.

### 26. 번역체

- Source: [ko-structure.md](../patterns/ko-structure.md)
- Type: rewrite-capable pattern
- Watch words: ~것은 사실이다, ~라고 할 수 있다, ~하는 것이 가능하다, ~에 의해 ~되다, ~에 대해 ~하다 (영어 "about"의 직역), ~하는 경향이 있다 (tend to), ~에 기반하여 (based on), ~를 통해서 (through), 그것은 ~이다 (It is ~)
- Fire condition: 한 문단 내에 번역체 표현이 2개 이상 등장할 때. 단독 1회 사용은 허용 — 정상적인 한국어에서도 간혹 나타나는 표현이므로.
- Example files: [failure](../examples/26-failure-01.md) · [success](../examples/26-success-01.md)

Example before:

> 이 기술이 유망하다는 것은 사실이다. 이 기술에 의해 많은 문제가 해결될 수 있다고 할 수 있다. 이 기술에 대해 관심을 갖는 것이 필요하며, 이 기술을 활용하는 것이 가능하다면 큰 성과를 거두는 것이 가능할 것이다.

Example after:

> 이 기술은 유망하다. 실제로 A사는 이걸로 불량률을 30% 줄였다. 관심 가질 만하고, 쓸 수 있으면 써보는 게 좋다.

### 27. 수동태 남용

- Source: [ko-structure.md](../patterns/ko-structure.md)
- Type: rewrite-capable pattern
- Watch words: ~되어지다, ~되어질 수 있다, ~되어져야 한다, ~되어지고 있다, ~되어진, ~에 의해 ~되다 (행위자가 분명한 경우)
- Fire condition: 이중 피동("~되어지다" 계열) 1회 이상 사용, 또는 "~에 의해 ~되다" 수동 구문이 2회 이상 반복될 때.
- Example files: [failure](../examples/27-failure-01.md) · [success](../examples/27-success-01.md)

Example before:

> 이 정책은 정부에 의해 시행되어지고 있다. 많은 변화가 이루어져야 한다고 판단되어진다. 국민의 의견이 반영되어져야 하며, 새로운 방안이 마련되어져야 할 것이다.

Example after:

> 정부가 이 정책을 시행하고 있다. 바꿀 게 많다. 국민 의견을 반영해야 하고, 새 방안도 필요하다.

### 28. 불필요한 외래어 남발

- Source: [ko-structure.md](../patterns/ko-structure.md)
- Type: rewrite-capable pattern
- Watch words: 인사이트, 임팩트, 레버리지, 이노베이션, 솔루션, 퍼포먼스, 거버넌스, 컨센서스, 시너지, 모멘텀, 마일스톤, 트리거, 매니징, 스케일업, 온보딩, 피드백 루프, 페인 포인트, 디시전 메이킹
- Fire condition: 한 문단 내에 한국어 대안이 있는 외래어가 3개 이상 등장할 때. 업계에서 정착된 전문 용어(예: 마케팅, 브랜딩)는 제외.
- Example files: [failure](../examples/28-failure-01.md) · [success](../examples/28-success-01.md)

Example before:

> 이번 프로젝트의 인사이트를 레버리지하여 시너지를 극대화하고, 지속 가능한 모멘텀을 확보하는 것이 핵심 마일스톤이다. 팀의 퍼포먼스를 높이기 위해 온보딩 프로세스를 개선하고, 페인 포인트를 해결하는 솔루션을 도입해야 한다.

Example after:

> 이번 프로젝트에서 얻은 교훈을 활용해서 협력 효과를 높이고, 추진력을 유지하는 것이 핵심 목표다. 팀 성과를 높이려면 신규 합류자 적응 과정을 개선하고, 현장의 문제를 해결할 방법을 찾아야 한다.

### 30. 수사적 질문 단락 시작

- Source: [ko-structure.md](../patterns/ko-structure.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 단락의 첫 문장이 의문형(`-까?`, `-는가?`, `-일까?`, `-는지?`)이고, 그 질문에 대한 답이 같은 단락 안에서 즉시 제시되는 경우. 또는 문서 전체에 단락 첫 문장으로 등장하는 수사적 질문이 2회 이상.
- Example files: [failure](../examples/30-failure-01.md) · [success](../examples/30-success-01.md)

Example before:

> 그렇다면 한국 커피 문화는 왜 이렇게 빠르게 성장했을까? 답은 의외로 단순하다. 카페가 단순한 음료 판매 공간을 넘어 사회적 거점으로 자리잡았기 때문이다.
>
> 그렇다면 앞으로의 전망은 어떨까? 전문가들은 이 트렌드가 당분간 지속될 것으로 보고 있다.

Example after:

> 한국 커피 문화가 이렇게 빨리 자란 이유는 의외로 단순하다. 카페가 음료를 파는 곳을 넘어 사람들이 모이는 거점이 됐다.
>
> 이 흐름은 당분간 이어질 것 같다. 전문가들도 같은 의견이다.

## 바이럴 훅 패턴 (score-only)

### Viral 1. 숫자 충격 훅

- Source: [ko-viral-hook.md](../patterns/ko-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: 단 N일/시간/주 만에, 단 N개월 만에, N억/N만 명/N만 개/N만 회, 0원으로 N원, 단돈 N원에, N% 폭증, N배 성장
- Fire condition: 단언에 충격적인 숫자(시간·규모·비율)가 등장하지만 같은 글 안에 출처·검증 경로가 없는 경우.

Detection example:

> 단 60일 만에 별 25만 개.
> 0원으로 100억 매출.

### Viral 2. 클릭베이트 미스터리 종결

- Source: [ko-viral-hook.md](../patterns/ko-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: ~이유가 뭘까, ~이유는 뭐였을까, ~이게 가능할까요, ~궁금하지 않나요, ~정말 충격이지 않나요, ~왜일까
- Fire condition: 글의 **마지막 문장**이 답을 주지 않는 수사적 질문이고, 본문이 그 질문에 충분한 답을 제공하지 않는 경우.

Detection example:

> 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.
> 이게 정말 가능한 일일까요?

### Viral 3. 검증 회피 단언

- Source: [ko-viral-hook.md](../patterns/ko-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: 역사상 처음, 역사상 이런 X은 없었다, 전 세계가 주목, 역대 최고, 유일무이한, ~에 따르면 (출처 명시 없이), ~로 알려졌다 (주체 없음)
- Fire condition: "역사상 X", "전 세계 Y", "역대 최고 Z" 같은 절대 범위/순위 단언이 출처·근거 없이 등장. 같은 글에 검증 가능한 다른 단서(링크·인용·스크린샷)도 부재.

Detection example:

> GitHub 역사상 이런 속도는 없었다.
> 전 세계 개발자들이 미친 듯이 달려든

### Viral 4. 호흡 최적화 단문 배열

- Source: [ko-viral-hook.md](../patterns/ko-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: (구조적 패턴 — 어휘가 아니라 형태로 판단)
- Fire condition: 글 전체가 거의 모두 한 문장 = 한 줄 = 한 단락 형식이고, 4문장 이상 연속이며, 평균 문장 길이가 30자 미만인 경우. 단문이 한두 개만 섞인 경우는 발화하지 않는다.

Detection example:

> GitHub 역사상 이런 속도는 없었다.
>
> 단 60일 만에 별 25만 개.
>
> OpenClaw라는 도구가 세운 기록임.
>
> 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.
> 
> (4문장 모두 1줄 단문, 줄바꿈으로 분리, 평균 25자 내외 → 발화)

### Viral 5. AI 인플루언서 어휘

- Source: [ko-viral-hook.md](../patterns/ko-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: 미친 듯이, 미쳤다, 역대급, 다 뒤집어졌다, 판이 바뀌었다, 이거 모르면 손해, 안 보면 후회, 충격적이지 않나요, 게임 체인저, 다들 난리난, 진짜 미쳤네, 이거 진심임
- Fire condition:

> - 한 글에 1개 등장: Low
> - 2개 등장: Medium
> - 3개 이상: High

Detection example:

> 전 세계 개발자들이 미친 듯이 달려든
> 역대급 도구가 등장했다
