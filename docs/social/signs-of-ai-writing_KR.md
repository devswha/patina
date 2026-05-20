# AI가 쓴 글처럼 보이는 신호 10가지

이 문서는 작성자 판별기가 아니라 편집 체크리스트입니다. 아래 항목은 모두 patina 패턴 카탈로그와 실제 before/after fixture에서 가져왔습니다.

초안을 고칠 때 옆에 두고 보세요.

짧은 카드뉴스를 만들 때는 한 줄씩 떼어 쓰면 됩니다.

이상한 항목이 보이면 먼저 연결된 예시를 확인하세요.

| # | 신호 | 실제 before → after | 출처 |
|---:|---|---|---|
| 1 | 평범한 사건을 `핵심적`, `획기적`, `전환점` 같은 말로 부풀립니다. | “핵심적인 역할… 획기적인 전환점” → “1983년 64K DRAM, 현재 시장 60%” | Pattern 1, `patterns/ko-content.md`; 예시: [`01-failure`](../../examples/01-failure-01.md) → [`01-success`](../../examples/01-success-01.md) |
| 3 | `~하며`, `~하고`, `~에 기여하며`가 이어지는데 인과가 없습니다. | “보여주며… 상징하고… 기여하며…” → 방문자 수와 매출 변화 | Pattern 3, `patterns/ko-content.md`; 예시: [`03-failure`](../../examples/03-failure-01.md) → [`03-success`](../../examples/03-success-01.md) |
| 7 | `다양한`, `혁신적인`, `체계적인`, `효과적인` 같은 AI 상투어가 몰립니다. | “다양한 혁신적인 기술들이…” → 배터리 칩과 NPU의 구체 수치 | Pattern 7, `patterns/ko-language.md`; 예시: [`07-failure`](../../examples/07-failure-01.md) → [`07-success`](../../examples/07-success-01.md) |
| 8 | `~적` 접미사가 문장마다 붙습니다. | “혁신적이고 체계적인… 효과적이고 효율적인…” → “승인 단계를 빼서 배포 시간을 절반으로 줄였다” | Pattern 8, `patterns/ko-language.md`; 예시: [`08-failure`](../../examples/08-failure-01.md) → [`08-success`](../../examples/08-success-01.md) |
| 9 | `~에 그치지 않고`, `비단 ~뿐만 아니라`로 말을 키웁니다. | “단순한 기술 발전에 그치지 않고…” → 제조, 물류, 고객 서비스 적용 순서 | Pattern 9, `patterns/ko-language.md`; 예시: [`09-failure`](../../examples/09-failure-01.md) → [`09-success`](../../examples/09-success-01.md) |
| 10 | 세 가지를 묶어야 할 이유 없이 3개 목록이 반복됩니다. | “창의성, 혁신성, 지속가능성” → 8주 실무 프로젝트 | Pattern 10, `patterns/ko-language.md`; 예시: [`10-failure`](../../examples/10-failure-01.md) → [`10-success`](../../examples/10-success-01.md) |
| 13 | `이를 통해`, `이러한 점에서`, `한편`, `이러한 맥락에서`가 문단을 밀어냅니다. | 연결 표현 네 번 → 수출 기업 영업이익과 중소기업 우려 | Pattern 13, `patterns/ko-style.md`; 예시: [`13-failure`](../../examples/13-failure-01.md) → [`13-success`](../../examples/13-success-01.md) |
| 15 | `**사용자 경험:**` 같은 인라인 헤더가 글을 카드뉴스처럼 만듭니다. | “**사용자 경험:** 새로운 인터페이스…” → 인터페이스, 속도, 암호화 변경을 한 문장으로 | Pattern 15, `patterns/ko-style.md`; 예시: [`15-failure`](../../examples/15-failure-01.md) → [`15-success`](../../examples/15-success-01.md) |
| 22 | `주목할 만한 점은`, `현 시점에서 볼 때`, `~라는 사실에 기인하여`가 의미 없이 길이를 늘립니다. | “주목할 만한 점은 현 시점에서 볼 때…” → “지금 경쟁사보다 기술력이 앞선다” | Pattern 22, `patterns/ko-filler.md`; 예시: [`22-failure`](../../examples/22-failure-01.md) → [`22-success`](../../examples/22-success-01.md) |
| 23 | `~일 수도`, `어느 정도`, `일정 부분`이 겹쳐서 책임 없는 문장이 됩니다. | “어느 정도의 효과를 가져올 수 있을 것으로…” → “이 정책은 효과가 있을 수 있다.” | Pattern 23, `patterns/ko-filler.md`; 예시: [`23-failure`](../../examples/23-failure-01.md) → [`23-success`](../../examples/23-success-01.md) |

## 써보기

초안을 patina로 돌린 뒤 audit을 보고 고칠지 결정하세요: <https://github.com/devswha/patina>. 웹 playground는 [#208](https://github.com/devswha/patina/issues/208)에서 추적 중입니다. 그 전에는 CLI나 에디터 스킬을 쓰면 됩니다.
