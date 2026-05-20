# Demo

A copy/paste demo for showing what patina does: remove AI packaging while keeping the claims intact.

## 30-second terminal transcript

This transcript uses the checked-in short marketing fixture so the example is reviewable without screenshots or a live model run.

```bash
$ cat examples/short/marketing-launch.md
새롭게 출시된 노션 템플릿 팩은 생산성 향상을 위한 혁신적인 솔루션입니다. 다양한 워크플로우에 최적화된 30개의 템플릿을 제공하며, 사용자 친화적인 디자인으로 누구나 손쉽게 활용 가능합니다. 본 제품은 업무 효율성을 극대화하는 새로운 패러다임을 제시합니다.

$ patina --lang ko --tone marketing examples/short/marketing-launch.md
새로 나온 노션 템플릿 팩에는 업무 흐름별로 바로 쓸 수 있는 템플릿 30개가 들어 있습니다. 복잡한 설정 없이 복제해서 쓰고, 팀이나 개인 작업 방식에 맞게 손보면 됩니다.

노션을 매번 빈 페이지에서 시작했다면, 이제 그 시간부터 줄이세요.
```

Full source/expected pair:
[`examples/short/marketing-launch.md`](../examples/short/marketing-launch.md) →
[`examples/short/marketing-launch-rewritten.md`](../examples/short/marketing-launch-rewritten.md).

## Before/after snapshots

| Genre | Before | After |
|---|---|---|
| Korean marketing | “생산성 향상을 위한 혁신적인 솔루션… 업무 효율성을 극대화하는 새로운 패러다임” | “업무 흐름별로 바로 쓸 수 있는 템플릿 30개… 빈 페이지에서 시작했다면, 이제 그 시간부터 줄이세요.” |
| Academic | “획기적인 성과가 관찰되었으며… 중요한 역할을 수행할 수 있음을 시사한다” | “평균 구축 시간은 72시간에서 10분 이내로 줄었다… 일반화하기에는 주의가 필요하다.” |
| Technical | “핵심적인 역할을 수행… 차세대 AI 인프라 환경의 표준” | “GPU 자원 관리는 배포 속도와 운영 비용에 직접 영향을 준다… 검토할 만한 선택지다.” |

Reference files:

- Academic: [`examples/genres/academic.md`](../examples/genres/academic.md) → [`examples/genres/academic-rewritten.md`](../examples/genres/academic-rewritten.md)
- Technical: [`examples/genres/technical.md`](../examples/genres/technical.md) → [`examples/genres/technical-rewritten.md`](../examples/genres/technical-rewritten.md)

## What to point out in a live demo

1. The output removes inflated claims like “혁신적인 솔루션” and “새로운 패러다임.”
2. Concrete facts survive: 30 templates, workflow fit, setup simplicity, and the user action.
3. The rewrite is auditable because the source fixture, expected rewrite, and pattern catalog all live in the repo.
