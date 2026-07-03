---
profile: commit-message
name: 커밋 메시지 프로필
version: 2.0.0
scope: Git commit subject/body, squash message, revert message, PR squash summary
pattern-overrides:
  ko:
    7: amplify                  # AI 고빈도 어휘 — 커밋에서는 특히 모호함
    22: amplify                 # 필러 — 히스토리에서는 삭제
    24: amplify                 # 낙관 결론 — 커밋 메시지에 불필요
    31: amplify                 # 결론 신호어 — subject/body에서 제거
  en:
    7: amplify                  # AI vocabulary — commit history needs precise nouns/verbs
    22: amplify                 # Filler — remove from commit bodies
    24: amplify                 # Generic positive conclusions — not useful in history
    31: amplify                 # Conclusion signals — no "In conclusion" in commits
  zh:
    7: amplify                  # AI高频词 — 提交记录需要具体动词
    22: amplify                 # 填充表达 — 删除
    24: amplify                 # 空泛乐观结尾 — 不适合提交历史
    31: amplify                 # 结论信号词 — 删除
  ja:
    7: amplify                  # AI語彙 — コミット履歴では具体語へ
    22: amplify                 # フィラー — 削除
    24: amplify                 # 空虚な楽観結論 — 不要
    31: amplify                 # 結論シグナル — 削除
---

# 커밋 메시지 프로필 (`commit-message`)

커밋 메시지는 변경 diff의 제목이 아니라 미래 디버깅을 위한 결정 기록이다. subject는 **명령형 또는 의도형**으로 짧게 쓰고, body는 제약·검증·기각한 대안을 남긴다.

## 범위

Git commit subject/body, squash message, revert message, PR squash summary. 릴리스 노트나 사용자-facing changelog는 `release-notes` 프로필을 쓴다.

## 적극 교정할 genre tell

1. **AI narrator preamble** — `This commit...`, `This change...`, `이 커밋은...`으로 시작하는 설명.
2. **Meaningless cleanup subject** — `Refactor code`, `Update files`, `Improve implementation`처럼 diff를 다시 말하는 제목.
3. **Inflated future promise** — `sets the stage`, `paves the way`, `향후 발전을 위한 기반` 같은 근거 없는 전망.
4. **Verification fog** — 테스트를 했는지, 안 했는지 알 수 없는 `various tests were run`류 표현.

## 작성 규칙

- subject는 72자 안팎으로, 가능한 한 "왜"를 말한다.
- `This commit`으로 시작하지 않는다. 바로 의도나 보호하려는 invariant를 쓴다.
- body가 필요하면 `Tested:`, `Constraint:`, `Rejected:` 같은 짧은 trailer를 선호한다.
- issue/PR 번호, 마이그레이션 위험, 배포 순서가 있으면 보존한다.

## Before / After

### Preamble 제거

**Before**
```text
This commit refactors the auth code to improve reliability.
```

**After**
```text
Auth retries need one owner for backoff state
```

### 모호한 cleanup 구체화

**Before**
```text
Improve tests and update files
```

**After**
```text
Score gates need a fixture that fails on invented categories

Tested: npm test; npm run lint:syntax.
```

### 전망 부풀리기 제거

**Before**
```text
This change lays the foundation for a more robust and scalable future.
```

**After**
```text
Persist cache keys with model and temperature

Constraint: cache entries must stay portable across API hosts.
```
