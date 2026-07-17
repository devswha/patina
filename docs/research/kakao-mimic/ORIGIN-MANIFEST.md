# kakao-mimic → patina import bundle

- Created: 2026-07-16 (ADR-025 acceptance execution, control-tower dispatch auto/T1)
- Source repository: flask (github devswha), snapshot at branch `refactor/adr-025-notification-terminal`, base commit `34d889a` (pre-severance)
- Authority: `ADR/ADR-025-notification-terminal-contraction.md` (Accepted 2026-07-16) — kakao-mimic research/code relocated for patina import; patina import itself is a SEPARATE control-tower dispatch, not performed here.

## Contents

| File | Original repo path | Role |
|---|---|---|
| `kakao_style.py` | `python/dgmh_runtime/memory/kakao_style.py` | Phase-2 RAG voice-anchor retrieval (TF-IDF top-K) + per-draft patina profile builder |
| `kakao_style_retrieval.py` | `python/dgmh_runtime/kakao_style_retrieval.py` | thin re-export shim |
| `test_kakao_style_retrieval.py` | `python/tests/test_kakao_style_retrieval.py` | retrieval/profile golden tests |
| `engine_patina_judge.py` | `python/dgmh_runtime/engine/patina_judge.py` | patina rewrite quality judge |
| `root_patina_judge.py` | `python/dgmh_runtime/patina_judge.py` | re-export shim |
| `test_patina_judge.py` | `python/tests/test_patina_judge.py` | judge tests |
| `humanness_rewrite_dispatch.py` | `python/dgmh_runtime/hermes_integration/humanness_hook/_rewrite.py` | static vs kakao-mimic-rag profile dispatch (integration reference) |

## Raw corpus (NOT in this bundle)

- `../corpus/kakao_hako_corpus.txt` — operator's private KakaoTalk messages (~157KB, mode 600).
- Moved from `~/.hermes/dgmh/kakao_hako_corpus.txt` on 2026-07-16.
- MUST NEVER be committed to any git remote. The patina import consumes it locally only.

## Not included (lives outside flask since the hermes import)

- `dgmh/patina_profiles/kakao-mimic.md` (static profile) and `build_kakao_mimic.py` — excluded from the flask import for privacy (see `dgmh/provenance/hermes-agent-import-3145e35a.skips.json`); recover from the hermes-agent archive if patina needs them.
