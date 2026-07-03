---
profile: release-notes
name: 릴리스 노트 프로필
version: 2.0.0
scope: changelog, release notes, GitHub Releases, npm/GHCR release announcement
pattern-overrides:
  ko:
    14: reduce                  # 볼드체 — 릴리스 노트 heading/emphasis 일부 허용
    15: reduce                  # 인라인 헤더 — 변경 분류에 허용
    24: amplify                 # 낙관 결론 — 구체적 영향으로 교체
    25: reduce                  # 번호/목록 구조 — 릴리스 노트에서는 표준
  en:
    14: reduce                  # Boldface — allowed for headings/emphasis
    15: reduce                  # Inline headers — standard in release notes
    24: amplify                 # Generic optimism — replace with user impact
    25: reduce                  # Numbered/list structure — legitimate here
  zh:
    14: reduce                  # 加粗 — 发布说明中可作为强调
    15: reduce                  # 内联标题 — 变更分类中可保留
    24: amplify                 # 空泛乐观结尾 — 改写为具体影响
    25: reduce                  # 列表结构 — 发布说明中正常
  ja:
    14: reduce                  # 太字 — リリースノートでは一部許容
    15: reduce                  # インラインヘッダー — 変更分類として許容
    24: amplify                 # 空虚な楽観結論 — 具体的な影響へ
    25: reduce                  # 箇条書き構造 — リリースノートでは標準
---

# 릴리스 노트 프로필 (`release-notes`)

릴리스 노트는 마케팅 카피와 운영 공지의 중간이다. 사용자가 궁금해하는 것은 "무엇이 바뀌었나"보다 **내가 무엇을 해야 하나**, **무엇이 깨질 수 있나**, **왜 업그레이드해야 하나**다.

## 범위

CHANGELOG 항목, GitHub Releases, npm/GHCR 릴리스 공지, 버전 업그레이드 안내. 내부 커밋 메시지는 `commit-message`, 긴 기술 설명은 `technical` 프로필을 쓴다.

## 적극 교정할 genre tell

1. **Generic excitement** — `We're excited to announce`, `a new chapter`, `앞으로가 기대됩니다`만 있고 영향이 없는 문장.
2. **Feature dump** — 항목은 많은데 사용자 영향, migration, breaking change가 빠진 목록.
3. **Hidden risk** — 버전·호환성·수동 조치가 필요한데 마지막에 흐리게 말하는 표현.
4. **Commit-log leakage** — `refactor`, `cleanup`, `internal improvements`만 있고 사용자-facing 변화가 없는 항목.

## 작성 규칙

- 각 항목은 가능하면 `Changed → Impact → Action` 순서로 쓴다.
- breaking change, deprecation, migration step은 숨기지 않는다.
- "excited"류 도입문은 삭제하거나 실제 사용자 이득으로 바꾼다.
- 구조화된 heading/bullet은 허용한다. 단, 모든 bullet이 같은 템플릿으로 끝나면 리듬을 바꾼다.

## Before / After

### Generic excitement 제거

**Before**
```markdown
We're excited to announce a powerful new release that unlocks a better future for all users.
```

**After**
```markdown
This release adds JSON score output and a CI gate, so PR workflows can fail when `overall` exceeds your threshold.
```

### Feature dump를 사용자 영향으로 전환

**Before**
```markdown
- Refactored cache internals
- Updated provider logic
- Improved reliability
```

**After**
```markdown
- Cache keys now include model, temperature, and API host. Re-run cached benchmarks once after upgrading.
- Provider fallback now stops on auth errors instead of retrying another backend with the same bad secret.
```

### 숨은 위험 드러내기

**Before**
```markdown
Some old settings may need to be adjusted for compatibility.
```

**After**
```markdown
Breaking: `--gate` now exits with code 3 when the score is over the threshold. CI jobs that treated any non-zero as infrastructure failure should allow exit 3 as a content gate.
```
