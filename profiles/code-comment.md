---
profile: code-comment
name: 코드 주석/docstring 프로필
version: 2.0.0
scope: 코드 주석, docstring, JSDoc/TSDoc, inline comment, TODO/FIXME 주석
pattern-overrides:
  ko:
    7: amplify                  # AI 고빈도 어휘 — 주석에서는 특히 소음
    8: amplify                  # ~적 접미사 — 동작/조건으로 풀기
    19: suppress                # 챗봇 표현 — 주석에서는 비해당
    22: amplify                 # 필러 — 삭제 우선
  en:
    7: amplify                  # AI vocabulary — comments should avoid decorative adjectives
    8: amplify                  # Copula avoidance — prefer direct code-action verbs
    19: suppress                # Chatbot phrasing — not relevant in code comments
    22: amplify                 # Filler — remove rather than polish
  zh:
    7: amplify                  # AI高频词 — 注释中应换成具体条件/行为
    18: amplify                 # 书面/公文体 — 注释不需要公文口吻
    19: suppress                # 聊天机器人痕迹 — 注释中不适用
    22: amplify                 # 填充表达 — 优先删除
  ja:
    7: amplify                  # AI語彙 — コメントでは具体的な動作へ置換
    8: amplify                  # 「〜的」形容詞 — 条件・処理内容に分解
    16: suppress                # 敬語 — コードコメントでは不要
    22: amplify                 # フィラー — 削除優先
---

# 코드 주석/docstring 프로필 (`code-comment`)

코드 옆 텍스트는 산문이 아니라 유지보수 단서다. 이 프로필은 주석을 짧게 만들되, **왜 이 코드가 필요한지**, **어떤 edge case를 막는지**, **입출력·불변조건이 무엇인지**를 남긴다.

## 범위

- inline comment, block comment, docstring, JSDoc/TSDoc, TODO/FIXME 주석
- README, API 문서, 튜토리얼은 `technical` 또는 `instructional` 프로필을 쓴다.
- 커밋 메시지는 `commit-message`, 릴리스 노트는 `release-notes` 프로필을 쓴다.

## 적극 교정할 genre tell

1. **Stock preamble** — `This function...`, `Returns the...`, `This method is used to...`처럼 선언부를 반복하는 말.
2. **Uninformative inline summary** — 코드가 이미 말하는 내용을 그대로 읽는 주석.
3. **AI-flavored TODO** — `TODO: consider improving this later`처럼 담당자, 조건, 실패 모드가 없는 TODO.
4. **Decorative assurance** — `robustly`, `seamlessly`, `효율적으로`, `체계적으로` 같은 형용사만 있고 조건이 없는 설명.

## 작성 규칙

- 함수명·타입에서 이미 알 수 있는 말은 지운다.
- 남길 주석은 "왜" 또는 "주의할 조건"을 말해야 한다.
- TODO/FIXME는 owner, issue id, trigger condition 중 최소 하나를 포함한다.
- 예외·fallback·security boundary는 삭제하지 않는다. 간결하게 다시 쓴다.

## Before / After

### Stock preamble

**Before**
```js
// This function validates the user input and returns a boolean value.
function isValidUser(input) { ... }
```

**After**
```js
// Reject empty OAuth subject IDs before they reach the account linker.
function isValidUser(input) { ... }
```

### Uninformative inline summary

**Before**
```js
count += 1; // increment count by one
```

**After**
```js
count += 1;
```

### AI-flavored TODO

**Before**
```js
// TODO: consider optimizing this in the future for better performance.
```

**After**
```js
// TODO(#421): cache permission lookups once the authz key includes tenant_id.
```

## 보존 주의

- 주석을 지우기 전에 코드만으로 같은 정보를 회복할 수 있는지 확인한다.
- 보안, 데이터 손실, race condition, 호환성 우회 설명은 짧아져도 남겨야 한다.
