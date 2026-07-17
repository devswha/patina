# kakao-mimic research artifacts

These files preserve the documentation and code exported from the `flask` repository during its 2026-07-16 ADR-025 severance. They are research references only and are not wired into Patina's product, CLI, benchmark, or playground.

## Provenance

- Decision: `flask/ADR/ADR-025-notification-terminal-contraction.md`
- Export bundle: `~/Documents/kakao-mimic/patina-import-bundle/`
- Flask source snapshot: branch `refactor/adr-025-notification-terminal`, base commit `34d889a`
- Original export inventory: [`ORIGIN-MANIFEST.md`](./ORIGIN-MANIFEST.md)

## Artifacts

- `artifacts/kakao_style.py`: TF-IDF retrieval over a locally supplied Kakao-style corpus and dynamic Patina profile construction.
- `artifacts/kakao_style_retrieval.py`: compatibility re-export for the retrieval module.
- `artifacts/engine_patina_judge.py`: Patina rewrite quality-judge implementation used by the former Flask runtime.
- `artifacts/root_patina_judge.py`: compatibility re-export for the judge implementation.
- `artifacts/test_patina_judge.py`: unit tests for judge parsing, invocation, and failure behavior.
- `artifacts/humanness_rewrite_dispatch.py`: integration reference showing static versus kakao-mimic-RAG rewrite dispatch.

## Privacy boundary

The raw KakaoTalk corpus remains outside every repository under `~/Documents/kakao-mimic/corpus/` and is not included here. The exported `test_kakao_style_retrieval.py` is also excluded because its fixtures contain personal-chat-derived message samples. No corpus text or personal chat content is committed in this directory.
