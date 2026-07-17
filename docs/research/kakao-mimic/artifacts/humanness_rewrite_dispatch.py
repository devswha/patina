from __future__ import annotations

import asyncio
import os
from typing import Optional

from dgmh_runtime.humanness_log import append_record, make_error_record, make_success_record

from ._common import logger
from ._modes import _patina_backend
from ._pollution import _prune_polluting_message, _read_soul_hash, _structural_pollution_check

async def _patina_rewrite_dispatch(
    content: str, *, timeout_s: float = 30.0, register_mode: str = "mirror"
) -> Optional[str]:
    """Pick between dynamic (kakao-mimic-rag) and static patina profiles.

    When ``DGMH_PATINA_PROFILE`` is ``kakao-mimic-rag``, build a per-call
    patina profile from TF-IDF-retrieved corpus anchors. Returns the
    rewritten text on success. The static-profile path is the steady
    state; the RAG path is the new Phase 2 surface that retrieves
    draft-specific voice anchors on every turn.

    Returns ``None`` on any failure path so the caller can decide
    whether to defer to the simpler Codex-direct rewrite.
    """
    from dgmh_runtime.engine.patina_judge import humanness_rewrite_with_profile

    profile_env = (os.environ.get("DGMH_PATINA_PROFILE", "") or "").strip()
    if profile_env == "kakao-mimic-rag":
        try:
            from dgmh_runtime.memory.kakao_style import rewrite_with_rag_profile

            rewritten = await asyncio.to_thread(
                rewrite_with_rag_profile,
                content,
                backend=_patina_backend(),
                timeout_s=timeout_s,
                register_mode=register_mode,
            )
        except Exception:
            logger.exception(
                "[humanness_hook] RAG profile path raised; "
                "falling back to static kakao-mimic"
            )
            rewritten = None
        if rewritten is not None:
            return rewritten
        # RAG returned None (no anchors / patina error). Fall through
        # to the static kakao-mimic profile so we still get *some*
        # voice mirroring instead of original content.
        return await asyncio.to_thread(
            humanness_rewrite_with_profile,
            content,
            profile="kakao-mimic",
            backend=_patina_backend(),
            timeout_s=timeout_s,
        )

    return await asyncio.to_thread(
        humanness_rewrite_with_profile,
        content,
        backend=_patina_backend(),
        timeout_s=timeout_s,
    )
def _score_in_thread(
    *,
    content: str,
    chat_id: str,
    thread_id: Optional[str],
    message_id: Optional[str],
) -> None:
    """Run patina scoring on a background thread and append the record."""
    soul_hash = _read_soul_hash()
    text_length = len(content)
    pruned_count = 0

    # Step 1: deterministic pre-check. Prune obvious structural pollution
    # without waiting for the slow Codex patina round-trip.
    structural_hit, struct_flags = _structural_pollution_check(content)
    if structural_hit and not os.environ.get("DGMH_PRUNE_DISABLED"):
        # Force prune by passing a synthetic high score above threshold.
        # Step 5 (v3): prune is keyed by recency, not content, so the
        # rewrite stages can mutate ``content`` mid-flight without breaking
        # the prune.
        pruned_pre = _prune_polluting_message(
            message_id=message_id, ai_score=999.0
        )
        if pruned_pre:
            logger.info(
                "[humanness_hook] structural pre-prune (%s) removed %d row",
                ",".join(struct_flags), pruned_pre,
            )
            pruned_count += pruned_pre

    try:
        from dgmh_runtime.engine.patina_judge import score_humanness, PatinaScoreError

        try:
            result = score_humanness(content, lang="ko")
            # Only attempt patina-based prune if the structural pre-check did
            # not already remove the row.
            if pruned_count == 0:
                pruned_count = _prune_polluting_message(
                    message_id=message_id, ai_score=result.ai_score
                )
                if pruned_count:
                    logger.info(
                        "[humanness_hook] pruned %d polluting reply (ai=%.1f >= threshold)",
                        pruned_count, result.ai_score,
                    )
            record = make_success_record(
                chat_id=chat_id,
                thread_id=thread_id,
                message_id=message_id,
                soul_md_hash=soul_hash,
                text_length=text_length,
                ai_score=result.ai_score,
                human_likeness=result.human_likeness,
                sub_scores=result.sub_scores,
                interpretation=result.interpretation,
                elapsed_s=result.elapsed_s,
            )
            record["pruned"] = pruned_count
            record["structural_flags"] = struct_flags
        except PatinaScoreError as exc:
            record = make_error_record(
                chat_id=chat_id,
                thread_id=thread_id,
                message_id=message_id,
                soul_md_hash=soul_hash,
                text_length=text_length,
                error=f"{type(exc).__name__}: {exc}",
            )
    except Exception as exc:  # noqa: BLE001 — never crash the gateway from a side hook
        record = make_error_record(
            chat_id=chat_id,
            thread_id=thread_id,
            message_id=message_id,
            soul_md_hash=soul_hash,
            text_length=text_length,
            error=f"unexpected: {type(exc).__name__}: {exc}",
        )

    try:
        append_record(record)
    except Exception:
        logger.exception("humanness_hook: failed to append record")
