---
profile: casual-conversation
name: 친한 대화체 프로필
version: 2.0.0
scope: 친구·지인 SNS, 댓글, 카카오톡 톤의 짧은 글
pattern-overrides:
  ko:
    8: amplify                  # ~적 접미사 — 친한 대화체에서는 더더욱 부자연스러움
    18: amplify                 # 한자어/공식어 — 한자어 대신 순한 단어 우선
    14: suppress                # 볼드체 — SNS/댓글에서는 사용 안 함
    19: reduce                  # 챗봇 표현 — 친한 톤이면 일부 허용 ("~해드릴게요" 등)
  en:
    8: amplify                  # Copula avoidance
    7: amplify                  # AI vocabulary
    14: suppress                # Boldface
  zh:
    7: amplify                  # AI高频词 — 亲密对话里“赋能/生态”特别不像人话
    18: amplify                 # 书面/公文体 — 朋友语气中应换成口语
    14: suppress                # 加粗 — 聊天/SNS语气中不作为AI痕迹处理
    19: reduce                  # 聊天机器人痕迹 — 亲切服务语可少量保留
  ja:
    7: amplify                  # AI語彙 — 親しい会話では特に不自然
    18: amplify                 # 硬質文体 — 友人向けなら口語へ寄せる
    16: amplify                 # 過剰敬語 — 親密な会話では距離が出るため強めに直す
    14: suppress                # 太字 — 会話調ではAI判定の主因にしない
    19: reduce                  # チャットボット痕跡 — 親切な一言は一部許容
---

# 친한 대화체 프로필 (`casual-conversation`)

친구·지인에게 카페에서 말하듯, 또는 친한 사이의 SNS·메신저 대화처럼 다듬는다.
"뉴스 톤"이나 "블로그 에세이 톤"이 아니라 **실제 입말에 가까운 친밀한 대화체**가 목표.

## 적용 예시

### Before (격식·뉴스 톤, 점수 0이지만 voice 차가움)
> 마케팅으로 뜬 게 아니다. 개발자들이 새벽 3시에 버그 잡다가 머리 쥐어뜯을 때 느끼던 그 가려운 지점을 정확히 긁어줬기 때문이다. NVIDIA가 이 무명 오픈소스와 손잡은 것도 우연이 아니다.

### After (`--profile casual-conversation` 적용)
> 에이, 마케팅 빨로 뜬 거 아니에요. 개발자들이 새벽 3시에 버그 잡다가 진짜 머리 쥐어뜯잖아요? 그 가려운 부분을 딱 긁어줬으니까 떴죠. NVIDIA가 이 듣보잡 오픈소스랑 손잡은 것도 다 이유가 있는 거예요.

## 다른 프로필과의 차이

| | blog | casual-conversation |
|---|---|---|
| 종결어미 | `~다` 평어 위주 | `~요`/`~죠` 친근체 위주 |
| 1인칭 | 적극 ("내가") | **더 적극** ("저는 이렇게 보거든요") |
| 청자 호명 | 가끔 | **상시** ("~잖아요?") |
| 한자어 | 일반적으로 허용 | **적극 순화** |
| 톤 비유 | 카페 에세이 | 카페 친구 대화 |

## 사용

```bash
patina --profile casual-conversation --lang ko input.txt
```

또는 `.patina.yaml`에:
```yaml
profile: casual-conversation
```

## 한계

- **단방향 변환**: 학술·기술 문서를 친밀체로 바꾸면 register mismatch 발생 가능. 의미 보존 우선.
- **MPS 영향**: 격식체로 진술된 사실을 풀어쓰는 과정에서 미묘한 hedge가 추가될 수 있음. fidelity floor 70 유지 필수.
- **번역체 고려 X**: 영어→한국어 번역 결과물에는 별도 대응 필요.
