# Demo

A copy/paste demo for showing what patina does: remove AI packaging while keeping the claims intact.

The animated README heroes are language-suffixed:

- English README: [`assets/demo/patina-demo-en.gif`](../assets/demo/patina-demo-en.gif), using
  [`examples/short/marketing-launch-en.md`](../examples/short/marketing-launch-en.md) →
  [`examples/short/marketing-launch-en-rewritten.md`](../examples/short/marketing-launch-en-rewritten.md)
- Korean README: [`assets/demo/patina-demo-ko.gif`](../assets/demo/patina-demo-ko.gif), using
  [`examples/short/marketing-launch.md`](../examples/short/marketing-launch.md) →
  [`examples/short/marketing-launch-rewritten.md`](../examples/short/marketing-launch-rewritten.md)
- Chinese and Japanese READMEs currently fall back to the English GIF until
  localized recordings are useful enough to maintain.

Re-recording notes live in [`assets/demo/README.md`](../assets/demo/README.md).

## 30-second terminal transcript

This transcript uses the checked-in English marketing fixture so the example is reviewable without screenshots or a live model run.

```bash
$ cat examples/short/marketing-launch-en.md
The newly released Notion template pack is an innovative solution designed to transform productivity for modern teams. It offers 30 templates optimized for diverse workflows, with a user-friendly design that enables anyone to leverage them effortlessly. This product introduces a new paradigm for maximizing work efficiency.

$ patina --lang en --tone marketing examples/short/marketing-launch-en.md
If Notion still starts as a blank page for your team, open this pack first. It includes 30 templates for common workflows. Duplicate one, adjust the fields you need, and use it for a team project or your own planning without starting from scratch.
```

Full source/expected pair:
[`examples/short/marketing-launch-en.md`](../examples/short/marketing-launch-en.md) →
[`examples/short/marketing-launch-en-rewritten.md`](../examples/short/marketing-launch-en-rewritten.md).

## Korean terminal transcript

This is the Korean fixture used by `README_KR.md`.

```bash
$ cat examples/short/marketing-launch.md
새롭게 출시된 노션 템플릿 팩은 생산성 향상을 위한 혁신적인 솔루션입니다. 다양한 워크플로우에 최적화된 30개의 템플릿을 제공하며, 사용자 친화적인 디자인으로 누구나 손쉽게 활용 가능합니다. 본 제품은 업무 효율성을 극대화하는 새로운 패러다임을 제시합니다.

$ patina --lang ko --tone marketing examples/short/marketing-launch.md
노션을 자주 쓰지만 매번 빈 페이지에서 막힌다면 이 팩부터 열어 보세요. 업무별 템플릿 30개를 담았습니다. 복잡한 설정 없이 복제해서 바로 고치고, 팀 프로젝트든 개인 정리든 필요한 형태로 손보면 됩니다.
```

Full source/expected pair:
[`examples/short/marketing-launch.md`](../examples/short/marketing-launch.md) →
[`examples/short/marketing-launch-rewritten.md`](../examples/short/marketing-launch-rewritten.md).

## Before/after snapshots

| Genre | Before | After |
|---|---|---|
| Korean marketing | “생산성 향상을 위한 혁신적인 솔루션… 업무 효율성을 극대화하는 새로운 패러다임” | “업무별 템플릿 30개… 팀 프로젝트든 개인 정리든 필요한 형태로 손보면 됩니다.” |
| Academic | “획기적인 성과가 관찰되었으며… 중요한 역할을 수행할 수 있음을 시사한다” | “평균 구축 시간은 72시간에서 10분 이내로 줄었다… 일반화하기에는 주의가 필요하다.” |
| Technical | “핵심적인 역할을 수행… 차세대 AI 인프라 환경의 표준” | “GPU 자원 관리는 배포 속도와 운영 비용에 직접 영향을 준다… 검토할 만한 선택지다.” |

Reference files:

- Academic: [`examples/genres/academic.md`](../examples/genres/academic.md) → [`examples/genres/academic-rewritten.md`](../examples/genres/academic-rewritten.md)
- Technical: [`examples/genres/technical.md`](../examples/genres/technical.md) → [`examples/genres/technical-rewritten.md`](../examples/genres/technical-rewritten.md)

## What to point out in a live demo

1. The output removes inflated claims like “혁신적인 솔루션” and “새로운 패러다임.”
2. Concrete facts survive: 30 templates, workflow fit, setup simplicity, and the user action.
3. The rewrite is auditable because the source fixture, expected rewrite, and pattern catalog all live in the repo.
