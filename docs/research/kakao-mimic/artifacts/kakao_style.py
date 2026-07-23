"""TF-IDF retrieval over the operator's KakaoTalk style corpus.

Phase 2 of the patina kakao-mimic plan. Instead of a static set of voice
anchors baked into the profile, retrieve the top-K stylistically nearest
real-user messages per draft and inject them as in-context examples for
the patina rewrite.

Index is built lazily on first ``retrieve_top_k`` call and cached in
process. The corpus file is one message per line at
``~/.dgmh-runtime/dgmh/kakao_hako_corpus.txt`` (private, kept outside the
repo). Tokenization uses whitespace eojeols plus character bigrams to
stay robust against Korean agglutination without an external dep.

The retrieval helper does not call patina; it just returns anchor lines.
``build_kakao_rag_profile_body`` renders a patina profile markdown body
around those anchors so the humanness hook can write a per-call profile
file and invoke ``patina --profile <name>``.
"""

from __future__ import annotations

import logging
import math
import os
import re
import threading
from collections import Counter
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

def _default_corpus_path() -> Path:
    from dgmh_runtime.config import dgmh_home

    return dgmh_home() / "kakao_hako_corpus.txt"


_URL_RE = re.compile(r"https?://|www\.")


class _StyleCorpus:
    """In-memory TF-IDF index over short Korean casual messages."""

    def __init__(self, messages: list[str]):
        self.messages: list[str] = messages
        docs_tokens: list[list[str]] = [self._tokenize(m) for m in messages]
        df: Counter[str] = Counter()
        for tokens in docs_tokens:
            for tok in set(tokens):
                df[tok] += 1
        N = max(len(messages), 1)
        self.idf: dict[str, float] = {
            tok: math.log((N + 1) / (cnt + 1)) + 1.0 for tok, cnt in df.items()
        }
        self.doc_vecs: list[dict[str, float]] = [
            self._vectorize(tokens) for tokens in docs_tokens
        ]
        self.doc_norms: list[float] = [
            math.sqrt(sum(v * v for v in vec.values())) or 1.0
            for vec in self.doc_vecs
        ]

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        # Eojeol-level tokens for surface match (helps with English words
        # like "Python" or "docker" that appear verbatim).
        words = [w for w in text.split() if w]
        # Character bigrams over the whole string capture Korean morph
        # patterns that whitespace eojeols miss. Skip pure-whitespace
        # bigrams.
        bigrams: list[str] = []
        for i in range(len(text) - 1):
            bg = text[i : i + 2]
            if not bg.isspace():
                bigrams.append(bg)
        return words + bigrams

    def _vectorize(self, tokens: list[str]) -> dict[str, float]:
        counts = Counter(tokens)
        return {
            tok: (1.0 + math.log(freq)) * self.idf.get(tok, 0.0)
            for tok, freq in counts.items()
        }

    def retrieve(
        self, query: str, k: int = 12, min_score: float = 0.05
    ) -> list[str]:
        query = query.strip()
        if not query or not self.messages:
            return []
        q_vec = self._vectorize(self._tokenize(query))
        q_norm = math.sqrt(sum(v * v for v in q_vec.values()))
        if q_norm <= 0:
            return []
        scored: list[tuple[float, int]] = []
        for idx, (dvec, dnorm) in enumerate(zip(self.doc_vecs, self.doc_norms)):
            if dnorm == 0:
                continue
            # Iterate over the shorter dict for the dot product.
            if len(q_vec) < len(dvec):
                dot = sum(v * dvec.get(tok, 0.0) for tok, v in q_vec.items())
            else:
                dot = sum(v * q_vec.get(tok, 0.0) for tok, v in dvec.items())
            if dot <= 0:
                continue
            score = dot / (q_norm * dnorm)
            if score >= min_score:
                scored.append((score, idx))
        scored.sort(key=lambda t: -t[0])
        return [self.messages[i] for _, i in scored[:k]]


_corpus_lock = threading.Lock()
_corpus_instance: Optional[_StyleCorpus] = None
_corpus_source: Optional[Path] = None


def _load_corpus(path: Path) -> _StyleCorpus:
    raw = path.read_text(encoding="utf-8")
    messages = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if _URL_RE.search(line):
            continue
        if line.startswith("@") or line.startswith("[20"):
            continue
        if len(line) < 4:
            continue
        messages.append(line)
    if not messages:
        raise RuntimeError(f"corpus at {path} produced 0 usable messages")
    return _StyleCorpus(messages)


def _get_corpus(corpus_path: Optional[Path] = None) -> _StyleCorpus:
    global _corpus_instance, _corpus_source
    raw_path = os.environ.get("DGMH_KAKAO_CORPUS_PATH", "")
    path = corpus_path or (Path(raw_path) if raw_path else _default_corpus_path())
    with _corpus_lock:
        if _corpus_instance is not None and _corpus_source == path:
            return _corpus_instance
        _corpus_instance = _load_corpus(path)
        _corpus_source = path
        logger.info(
            "[kakao_style_retrieval] indexed %d messages from %s",
            len(_corpus_instance.messages),
            path,
        )
        return _corpus_instance


def retrieve_top_k(
    draft: str, k: int = 12, corpus_path: Optional[Path] = None
) -> list[str]:
    """Return up to k stylistically nearest corpus messages for ``draft``.

    Falls back to an empty list when the corpus file is missing or yields
    no messages above the similarity floor. Caller is expected to handle
    the empty case (typically by skipping the dynamic profile path and
    falling back to the static kakao-mimic profile).
    """
    try:
        corpus = _get_corpus(corpus_path)
    except Exception as e:
        logger.warning("[kakao_style_retrieval] corpus load failed: %s", e)
        return []
    try:
        return corpus.retrieve(draft, k=k)
    except Exception as e:
        logger.warning("[kakao_style_retrieval] retrieve failed: %s", e)
        return []


def build_kakao_rag_profile_body(
    anchors: list[str], *, register_mode: str = "mirror"
) -> str:
    """Render a per-call patina profile body around the retrieved anchors.

    Mirrors the static ``kakao-mimic.md`` layout but advertises the
    anchors as draft-specific. The same voice/pattern overrides apply.
    """
    if not anchors:
        return ""
    lines = [
        "---",
        "profile: kakao-mimic-rag",
        "name: 카카오톡 본인 문체 미러 프로필 (per-draft retrieval)",
        "version: 1.0.0",
        "scope: 운영자 카톡 코퍼스에서 본 draft와 가장 가까운 메시지 K개를 동적으로 주입",
        "voice-overrides:",
        "  first-person: amplify",
        "  opinions: amplify",
        "  rhythm-variation: amplify",
        "  humor: allow",
        "  messiness: amplify",
        "  concrete-emotions: amplify",
        "  reader-address: amplify",
        "  hedge-tone: amplify",
        "pattern-overrides:",
        "  ko:",
        "    8: amplify",
        "    18: amplify",
        "    14: suppress",
        "    19: reduce",
        "  en:",
        "    8: amplify",
        "    7: amplify",
        "    14: suppress",
        "---",
        "",
        "# 카카오톡 본인 문체 미러 프로필 (draft-specific)",
        "",
        "운영자의 실제 카톡 메시지 중, 지금 다듬을 draft와 토큰·문맥 유사도가",
        f"가장 높은 {len(anchors)}개를 골라 voice anchor로 사용한다. 어미·길이·필러 사용·",
        "오타 허용도·인터넷 슬랭 빈도를 그대로 미러링한다.",
        "",
        "## Voice 가이드라인",
        "",
        "- 압도적 다수는 30자 미만 단문. 끝맺지 않는 문장 자연스러움.",
        "- 어미 다양: 요/죠/임/슴다/거든요/읍니다/임까/용/여.",
        "- 필러: ㅋㅋ/ㅎㅎ/ㄷㄷ/ㅇㅇ/굿ㅋㅋㅋ 자유롭게.",
        "- 입력 속도 오타·축약 그대로 둠 (쪼아요/괜찮슴다/넘/되엇네/아닉ㅆ지).",
        "- 백틱 `…` / **굵게** / *기울임* / 헤더 모두 금지.",
        "- hedging(같아요/보여요/~듯)은 한 응답에 한 번까지.",
        "- 의견은 1인칭으로 한쪽만: \"난 ~쪽이야\".",
        "",
    ]
    if register_mode == "public_haeyo":
        lines.extend(
            [
                "## Register lock (public Discord)",
                "",
                "- 이 profile은 공개 Discord 봇대화용이다. 최종문은 해요체-casual 하나로 고정한다.",
                "- `~요`, `~죠`, `~네요`, `~네여`, `~슴다/읍니다`, `~용/여`는 허용한다.",
                "- `~야`, `~해`, `~할게`, `~좋아`, `~맞아`, `~몰라`, `~가자` 같은 반말 종결은 쓰지 않는다.",
                "- anchor에 반말이 있어도 어미는 해요체-casual로 변환하고, 한 답변 안에서 존댓말/반말을 섞지 않는다.",
                "",
            ]
        )
    lines.extend(
        [
            "## Reference voice anchors (draft-specific top-K)",
            "",
            "다음 메시지들은 운영자의 실제 카톡 그룹 대화에서 본 draft와 가장 가까운 항목들이다.",
            "그대로 따라하지 말고, 톤·길이·어미 패턴만 미러링한다.",
            "",
            "```",
        ]
    )
    lines.extend(anchors)
    lines.extend(["```", ""])
    return "\n".join(lines) + "\n"


def _default_patina_profiles_dir() -> Path:
    patina_bin = os.environ.get("DGMH_PATINA_BIN", "").strip()
    if patina_bin:
        # patina resolves profiles from its own repo root (`bin/patina.js` → `profiles/`).
        return Path(patina_bin).expanduser().resolve().parents[1] / "profiles"

    from dgmh_runtime.config import skills_home

    return skills_home() / "creative" / "patina" / "profiles"


def rewrite_with_rag_profile(
    text: str,
    *,
    k: int = 12,
    backend: str = "codex-cli",
    lang: str = "ko",
    timeout_s: float = 30.0,
    profiles_dir: Optional[Path] = None,
    register_mode: str = "mirror",
) -> Optional[str]:
    """Run patina with a per-call profile populated by retrieved anchors.

    Returns the rewritten text on success, or ``None`` when retrieval
    yields no anchors / patina invocation fails. Callers fall back to
    the static ``kakao-mimic`` profile (or original text) on ``None``.

    The per-call profile file is named with a random suffix so concurrent
    turns cannot collide on the same path. It's deleted in a ``finally``
    block even when patina raises.
    """
    if not text or not text.strip():
        return None
    anchors = retrieve_top_k(text, k=k)
    if not anchors:
        logger.info(
            "[kakao_style_retrieval] no anchors retrieved; "
            "caller should fall back to static profile"
        )
        return None

    import uuid

    profile_dir = profiles_dir or _default_patina_profiles_dir()
    if not profile_dir.is_dir():
        logger.warning(
            "[kakao_style_retrieval] patina profiles dir missing: %s",
            profile_dir,
        )
        return None

    profile_name = f"kakao-mimic-rag-{uuid.uuid4().hex[:8]}"
    profile_path = profile_dir / f"{profile_name}.md"
    body = build_kakao_rag_profile_body(anchors, register_mode=register_mode)
    try:
        profile_path.write_text(body, encoding="utf-8")
    except OSError as e:
        logger.warning(
            "[kakao_style_retrieval] failed to write profile %s: %s",
            profile_path,
            e,
        )
        return None

    try:
        from dgmh_runtime.engine.patina_judge import humanness_rewrite_with_profile

        return humanness_rewrite_with_profile(
            text,
            profile=profile_name,
            backend=backend,
            lang=lang,
            timeout_s=timeout_s,
        )
    finally:
        try:
            profile_path.unlink(missing_ok=True)
        except OSError:
            logger.debug(
                "[kakao_style_retrieval] could not unlink profile %s",
                profile_path,
            )


def _reset_for_tests() -> None:
    """Drop the cached corpus so tests can re-index from a tmp path."""
    global _corpus_instance, _corpus_source
    with _corpus_lock:
        _corpus_instance = None
        _corpus_source = None
