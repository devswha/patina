#!/usr/bin/env python3
"""patina-max composite: deterministic 4-axis winner reselection over an
existing patina-max run directory.

The default patina-max winner picker only sees AI-likeness and MPS, so it
goes noise-bound when a baseline is already humanized. This script adds two
Korean-aware deterministic metrics — Register Stability Score (RSS) and
Edit Conservativeness (EditCons) — and reselects the winner.

Usage
-----
    python3 patina-max/composite.py <run_dir> [--weights ...]

Layout consumed
---------------
    <run_dir>/
        input.md      baseline source MDX (required)
        claude.md     candidate (optional; absent → "missing")
        gemini.md     candidate (optional)
        codex.md      candidate (optional; may be a failure note)
        meta.md       YAML; per-candidate ai_score / mps / status (recommended)

Layout produced
---------------
    <run_dir>/
        composite.md   per-candidate metric table + weighted totals
        winner.md      winning candidate's text (or a none-found notice)

Default weights (renormalised after dropping the LLM-Judge slot):

    AI=0.353  MPS=0.235  RSS=0.235  EditCons=0.176

Override via .patina.default.yaml:

    composite-weights:
      ai: 0.353
      mps: 0.235
      rss: 0.235
      edit_cons: 0.176

Or inline:

    python3 patina-max/composite.py <run_dir> --weights ai=0.4,rss=0.3
"""

from __future__ import annotations

import argparse
import difflib
import math
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Korean register / edit metrics
# ---------------------------------------------------------------------------

# Sentence-final ending vocabulary. Order matters — longer forms first so the
# regex engine matches `합니다` before falling back to `다`.
_ENDING_PATTERNS = [
    # 합쇼체 (deferential formal): ~ㅂ니다 / ~습니다 / ~ㅂ니까 / ~습니까 / ~십시오
    ("hapsho", r"(?:[가-힣]니다|[가-힣]니까|[가-힣]시오|십시오|십시요)"),
    # 해요체 (polite informal)
    ("haeyo", r"(?:세요|예요|이에요|에요|해요|어요|아요|네요|군요|지요|죠|[가-힣]요)"),
    # 해라체 (plain declarative / imperative)
    ("haera", r"(?:[가-힣]는다|한다|[가-힣]다|하라|마라|보라|들라|[가-힣]아라|[가-힣]어라|[가-힣]라)"),
    # 해체 (casual / 반말)
    ("hae", r"(?:해|야|아|어|네|군|지)"),
]

_SENTENCE_SPLIT = re.compile(r"[.!?。]+\s+|\n+")
_TRAILING_PUNCT = re.compile(r"[\s.,!?;:。、]+$")


def _strip_markdown_noise(text: str) -> str:
    """Drop fenced code blocks, JSX tags, image lines, and href payloads.

    Composite metrics are about Korean prose. MDX fences and JSX scaffolding
    would otherwise inflate the token count and skew Edit Conservativeness.
    """
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"<[A-Z][\w]*\b[^>]*?/?>", "", text)
    text = re.sub(r"</[A-Z][\w]*>", "", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\A---\n[\s\S]*?\n---\n", "", text)
    return text


def _split_sentences(text: str) -> list[str]:
    cleaned = _strip_markdown_noise(text)
    parts = _SENTENCE_SPLIT.split(cleaned)
    sentences: list[str] = []
    for part in parts:
        for line in part.splitlines():
            line = line.strip()
            if not line:
                continue
            line = re.sub(r"^\s*([>#\-*]+\s*)+", "", line)
            line = re.sub(r"^\*\*[^*]+\*\*[\s:—-]*", "", line)
            line = line.strip()
            if line:
                sentences.append(line)
    return sentences


def ending_distribution(text: str) -> Counter[str]:
    dist: Counter[str] = Counter()
    for sentence in _split_sentences(text):
        tail = _TRAILING_PUNCT.sub("", sentence)
        if not tail:
            continue
        bucket = "other"
        for name, pattern in _ENDING_PATTERNS:
            if re.search(pattern + r"$", tail):
                bucket = name
                break
        dist[bucket] += 1
    return dist


def cosine_similarity(a: Counter[str], b: Counter[str]) -> float:
    keys = set(a) | set(b)
    if not keys:
        return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def register_stability(baseline: str, candidate: str) -> float:
    """RSS: cosine similarity of register distributions, scaled to 0-100."""
    return cosine_similarity(ending_distribution(baseline), ending_distribution(candidate)) * 100.0


def edit_conservativeness(baseline: str, candidate: str) -> float:
    """EditCons: SequenceMatcher ratio on whitespace tokens (0-100)."""
    base_tokens = _strip_markdown_noise(baseline).split()
    cand_tokens = _strip_markdown_noise(candidate).split()
    if not base_tokens and not cand_tokens:
        return 100.0
    if not base_tokens or not cand_tokens:
        return 0.0
    matcher = difflib.SequenceMatcher(None, base_tokens, cand_tokens, autojunk=False)
    return matcher.ratio() * 100.0


# ---------------------------------------------------------------------------
# Composite scoring + run-dir IO
# ---------------------------------------------------------------------------

DEFAULT_WEIGHTS = {
    "ai": 0.353,
    "mps": 0.235,
    "rss": 0.235,
    "edit_cons": 0.176,
}

CANDIDATE_MODELS = ("claude", "gemini", "codex")
RUN_FRONTMATTER = re.compile(r"\A---\n([\s\S]*?)\n---\n", re.MULTILINE)
NUMBER_RANGE = re.compile(r"(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)")
SINGLE_NUMBER = re.compile(r"(\d+(?:\.\d+)?)")
NON_NUMERIC_PLACEHOLDERS = {"n/a", "na", "none", "—", "-", "pending", "tbd", "unknown"}


@dataclass
class Candidate:
    model: str
    text: str
    ai_score: Optional[float] = None
    mps: Optional[float] = None
    rss: Optional[float] = None
    edit_cons: Optional[float] = None
    composite: Optional[float] = None
    status: str = "unknown"
    notes: list[str] = field(default_factory=list)


def parse_metric(raw: Optional[str]) -> Optional[float]:
    """Coerce metric strings from meta.md into floats.

    `0-2 (within noise floor)` -> 1.0 (midpoint)
    `92 (all anchors preserved)` -> 92.0
    `n/a` / `pending` / `—` -> None
    """
    if raw is None:
        return None
    raw = str(raw).strip().strip('"').strip("'")
    if not raw or raw.lower() in NON_NUMERIC_PLACEHOLDERS:
        return None
    range_match = NUMBER_RANGE.search(raw)
    if range_match:
        return (float(range_match.group(1)) + float(range_match.group(2))) / 2.0
    single_match = SINGLE_NUMBER.search(raw)
    if single_match:
        return float(single_match.group(1))
    return None


def parse_meta_candidates(meta_text: str) -> dict[str, dict[str, str]]:
    """Pull per-candidate score lines from meta.md without a YAML library."""
    info: dict[str, dict[str, str]] = {}
    in_candidates = False
    current: Optional[dict[str, str]] = None
    for raw_line in meta_text.splitlines():
        line = raw_line.rstrip()
        if not line.startswith(" ") and line.endswith(":"):
            in_candidates = line.strip() == "candidates:"
            current = None
            continue
        if not in_candidates:
            continue
        stripped = line.lstrip()
        if stripped.startswith("- model:"):
            model = stripped.split(":", 1)[1].strip()
            current = {"model": model}
            info[model] = current
            continue
        if current is None:
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value == "|":
            value = "<multiline>"
        if key in {"ai_score", "ai_score_instructional", "ai_score_technical", "mps", "status", "wall_time_seconds"}:
            current[key] = value
    return info


def read_candidate_text(path: Path) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    return RUN_FRONTMATTER.sub("", text, count=1)


def normalise_weights(weights: dict[str, float]) -> dict[str, float]:
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("weights must sum to a positive number")
    return {k: v / total for k, v in weights.items()}


def parse_weight_overrides(spec: str) -> dict[str, float]:
    overrides: dict[str, float] = {}
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" not in chunk:
            raise ValueError(f"invalid weight override `{chunk}` (expected key=value)")
        key, value = chunk.split("=", 1)
        key = key.strip().lower()
        if key not in DEFAULT_WEIGHTS:
            raise ValueError(f"unknown weight key `{key}`; valid: {sorted(DEFAULT_WEIGHTS)}")
        try:
            overrides[key] = float(value)
        except ValueError as exc:
            raise ValueError(f"weight `{key}` not a number: {value}") from exc
    return overrides


def load_yaml_weights(yaml_path: Path) -> dict[str, float]:
    """Pick `composite-weights:` out of the patina config without PyYAML."""
    if not yaml_path.exists():
        return {}
    weights: dict[str, float] = {}
    in_block = False
    for raw_line in yaml_path.read_text(encoding="utf-8").splitlines():
        if raw_line.startswith("composite-weights:"):
            in_block = True
            continue
        if in_block:
            if not raw_line.startswith(" "):
                break
            stripped = raw_line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if ":" not in stripped:
                break
            key, value = stripped.split(":", 1)
            key = key.strip().lower()
            try:
                weights[key] = float(value.strip().split("#", 1)[0].strip())
            except ValueError:
                continue
    return {k: v for k, v in weights.items() if k in DEFAULT_WEIGHTS}


def resolve_weights(yaml_path: Path, cli_override: Optional[str]) -> dict[str, float]:
    weights = dict(DEFAULT_WEIGHTS)
    weights.update(load_yaml_weights(yaml_path))
    if cli_override:
        weights.update(parse_weight_overrides(cli_override))
    return normalise_weights(weights)


def composite_score(candidate: Candidate, weights: dict[str, float]) -> Optional[float]:
    if candidate.status != "success":
        return None
    if any(v is None for v in (candidate.ai_score, candidate.mps, candidate.rss, candidate.edit_cons)):
        return None
    return (
        (100.0 - candidate.ai_score) * weights["ai"]
        + candidate.mps * weights["mps"]
        + candidate.rss * weights["rss"]
        + candidate.edit_cons * weights["edit_cons"]
    )


def render_composite_md(
    run_dir: Path,
    weights: dict[str, float],
    candidates: list[Candidate],
    winner: Optional[Candidate],
) -> str:
    lines: list[str] = []
    lines.append(f"# patina-composite scores for `{run_dir.name}`")
    lines.append("")
    lines.append("Generated by `patina-max/composite.py` — deterministic 4-axis reselection.")
    lines.append("")
    lines.append("## Weights")
    lines.append("")
    lines.append("| Axis | Weight |")
    lines.append("|------|-------:|")
    for key in ("ai", "mps", "rss", "edit_cons"):
        lines.append(f"| {key} | {weights[key]:.4f} |")
    lines.append("")
    lines.append("## Candidate scores")
    lines.append("")
    lines.append("| Model | Status | AI | MPS | RSS | EditCons | Composite |")
    lines.append("|-------|--------|---:|----:|----:|--------:|----------:|")
    for cand in candidates:
        ai = "—" if cand.ai_score is None else f"{cand.ai_score:.1f}"
        mps = "—" if cand.mps is None else f"{cand.mps:.1f}"
        rss = "—" if cand.rss is None else f"{cand.rss:.1f}"
        edit = "—" if cand.edit_cons is None else f"{cand.edit_cons:.1f}"
        comp = "—" if cand.composite is None else f"{cand.composite:.2f}"
        lines.append(f"| {cand.model} | {cand.status} | {ai} | {mps} | {rss} | {edit} | {comp} |")
    lines.append("")
    if winner:
        lines.append(f"**Winner:** `{winner.model}` — composite {winner.composite:.2f}")
    else:
        lines.append("**Winner:** none (no candidate scored successfully)")
    lines.append("")
    if any(cand.notes for cand in candidates):
        lines.append("")
        lines.append("## Notes")
        for cand in candidates:
            for note in cand.notes:
                lines.append(f"- **{cand.model}**: {note}")
    return "\n".join(lines) + "\n"


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="patina-max composite winner reselection.")
    parser.add_argument("run_dir", type=Path, help="path to a patina-max run dir")
    parser.add_argument(
        "--weights",
        type=str,
        default=None,
        help="override weights, comma-separated (e.g. ai=0.4,rss=0.3)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / ".patina.default.yaml",
        help="patina config to read composite-weights from",
    )
    args = parser.parse_args(argv)

    run_dir: Path = args.run_dir.resolve()
    if not run_dir.is_dir():
        print(f"error: not a directory: {run_dir}", file=sys.stderr)
        return 2

    input_path = run_dir / "input.md"
    if not input_path.exists():
        print(f"error: missing required file: {input_path}", file=sys.stderr)
        return 2
    baseline = read_candidate_text(input_path)

    meta_path = run_dir / "meta.md"
    meta_info: dict[str, dict[str, str]] = {}
    if meta_path.exists():
        meta_info = parse_meta_candidates(meta_path.read_text(encoding="utf-8"))
    else:
        print(f"warning: missing meta.md at {meta_path}; AI/MPS will be marked unknown", file=sys.stderr)

    weights = resolve_weights(args.config, args.weights)

    candidates: list[Candidate] = []
    for model in CANDIDATE_MODELS:
        path = run_dir / f"{model}.md"
        if not path.exists():
            candidates.append(Candidate(model=model, text="", status="missing"))
            continue
        text = read_candidate_text(path)
        info = meta_info.get(model, {})
        cand = Candidate(
            model=model,
            text=text,
            status=info.get("status", "unknown"),
            ai_score=parse_metric(info.get("ai_score") or info.get("ai_score_instructional") or info.get("ai_score_technical")),
            mps=parse_metric(info.get("mps")),
        )
        if cand.status == "success" and cand.text.strip():
            cand.rss = register_stability(baseline, cand.text)
            cand.edit_cons = edit_conservativeness(baseline, cand.text)
        else:
            cand.notes.append("skipping deterministic metrics (status not success or empty text)")
        cand.composite = composite_score(cand, weights)
        if cand.status == "success" and cand.composite is None:
            cand.notes.append("composite undefined — at least one of AI/MPS could not be parsed from meta.md")
        candidates.append(cand)

    scored = [c for c in candidates if c.composite is not None]
    winner: Optional[Candidate] = max(scored, key=lambda c: c.composite) if scored else None

    composite_path = run_dir / "composite.md"
    composite_path.write_text(
        render_composite_md(run_dir, weights, candidates, winner),
        encoding="utf-8",
    )

    winner_path = run_dir / "winner.md"
    if winner is not None:
        winner_path.write_text(
            f"---\nwinner_model: {winner.model}\ncomposite_score: {winner.composite:.2f}\n---\n\n{winner.text.lstrip()}",
            encoding="utf-8",
        )
    else:
        winner_path.write_text("# winner.md\n\nNo candidate scored successfully.\n", encoding="utf-8")

    cwd = Path.cwd()
    print(f"wrote {composite_path.relative_to(cwd) if composite_path.is_relative_to(cwd) else composite_path}")
    print(f"wrote {winner_path.relative_to(cwd) if winner_path.is_relative_to(cwd) else winner_path}")
    if winner:
        print(f"winner: {winner.model} (composite {winner.composite:.2f})")
    else:
        print("winner: none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
