#!/usr/bin/env python3
"""Render a small README demo GIF from checked-in text fixtures.

This is an optional asset-generation helper. It keeps README hero demos
reproducible without adding a runtime dependency to the Node package, and
without needing a live model call (the rewrite is read from a checked-in
fixture). Requires Pillow in the local environment:

    python3 -m pip install pillow

The animation mimics a real terminal: prompts are typed out character by
character with a blinking block cursor, command output appears line by line,
and a trailing prompt blinks at rest.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover - only used by humans
    raise SystemExit(
        "Pillow is required to render demo GIFs. Install it with: "
        "python3 -m pip install pillow"
    ) from exc


WIDTH = 820
HEIGHT = 600
PADDING_X = 34
PADDING_TOP = 72
LINE_GAP = 8
CURSOR = "█"  # full block

# Typing/animation pacing (ms).
TYPE_MS = 42
CURSOR_BLINK_MS = 430
LINE_REVEAL_MS = 150
HOLD_MS = 2400
CHARS_PER_FRAME = 2

COLORS = {
    "page": "#080b16",
    "terminal": "#0d1320",
    "bar": "#1b2334",
    "text": "#e5e7eb",
    "muted": "#8b98ad",
    "prompt": "#34d399",
    "command": "#d6f5e3",
    "before": "#fca5a5",
    "after": "#bfdbfe",
    "pass": "#86efac",
    "cursor": "#a7f3d0",
    "dot_red": "#f87171",
    "dot_yellow": "#fbbf24",
    "dot_green": "#34d399",
}


def find_font(size: int, lang: str) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    latin_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ]
    cjk_candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/nanum/NanumGothicCoding.ttf",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    ]
    candidates = (
        cjk_candidates + latin_candidates
        if lang in {"ko", "zh", "ja"}
        else latin_candidates + cjk_candidates
    )
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    """Pixel-width wrapping that also handles long CJK/no-space runs."""

    out: list[str] = []
    for paragraph in text.splitlines() or [""]:
        words = paragraph.split(" ")
        line = ""
        for word in words:
            candidate = word if not line else f"{line} {word}"
            if text_width(draw, candidate, font) <= max_width:
                line = candidate
                continue
            if line:
                out.append(line)
                line = ""
            chunk = ""
            for char in word:
                candidate = f"{chunk}{char}"
                if text_width(draw, candidate, font) <= max_width:
                    chunk = candidate
                else:
                    if chunk:
                        out.append(chunk)
                    chunk = char
            line = chunk
        out.append(line)
    return out


def build_segments(
    args: argparse.Namespace,
    draw: ImageDraw.ImageDraw,
    font: ImageFont.ImageFont,
) -> list[dict]:
    """Ordered timeline segments: typed commands and revealed output lines."""

    source = Path(args.source).read_text(encoding="utf-8").strip()
    rewrite = Path(args.rewrite).read_text(encoding="utf-8").strip()
    max_width = WIDTH - (PADDING_X * 2)
    src_name = Path(args.source).name
    cmd = f"patina --lang {args.lang} --tone marketing {src_name}"

    segments: list[dict] = []
    segments.append({"kind": "cmd", "text": f"cat {src_name}"})
    for line in wrap_text(draw, source, font, max_width):
        segments.append({"kind": "line", "text": line, "style": "before"})
    segments.append({"kind": "gap"})
    segments.append({"kind": "cmd", "text": cmd})
    for line in wrap_text(draw, rewrite, font, max_width):
        segments.append({"kind": "line", "text": line, "style": "after"})
    segments.append({"kind": "gap"})
    segments.append({"kind": "line", "text": args.score_line, "style": "pass"})
    return segments


def draw_frame(
    rows: list[tuple[str, str]],
    *,
    title: str,
    font: ImageFont.ImageFont,
    title_font: ImageFont.ImageFont,
) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), COLORS["page"])
    draw = ImageDraw.Draw(image)

    left, top, right, bottom = 18, 18, WIDTH - 18, HEIGHT - 18
    draw.rounded_rectangle((left, top, right, bottom), radius=18, fill=COLORS["terminal"])
    draw.rounded_rectangle((left, top, right, top + 42), radius=18, fill=COLORS["bar"])
    draw.rectangle((left, top + 24, right, top + 42), fill=COLORS["bar"])

    x = left + 22
    for name in ("dot_red", "dot_yellow", "dot_green"):
        draw.ellipse((x, top + 15, x + 12, top + 27), fill=COLORS[name])
        x += 20

    draw.text((left + 95, top + 12), title, fill=COLORS["muted"], font=title_font)

    prompt_w = text_width(draw, "$ ", font)
    line_height = (font.size + LINE_GAP) if hasattr(font, "size") else 24
    y = PADDING_TOP
    for text, style in rows:
        if not text and style not in {"rest", "cursor_at"}:
            y += line_height
            continue
        if style in {"command", "cursor_at"}:
            draw.text((PADDING_X, y), "$ ", fill=COLORS["prompt"], font=font)
            draw.text((PADDING_X + prompt_w, y), text, fill=COLORS["command"], font=font)
            if style == "cursor_at":
                cur_x = PADDING_X + prompt_w + text_width(draw, text, font)
                draw.text((cur_x, y), CURSOR, fill=COLORS["cursor"], font=font)
        elif style == "rest":
            draw.text((PADDING_X, y), "$ ", fill=COLORS["prompt"], font=font)
            if text:
                draw.text((PADDING_X + prompt_w, y), text, fill=COLORS["cursor"], font=font)
        else:
            draw.text((PADDING_X, y), text, fill=COLORS[style], font=font)
        y += line_height
    return image


def main() -> int:
    args = parse_args()
    font = find_font(17, args.lang)
    title_font = find_font(15, args.lang)
    scratch = ImageDraw.Draw(Image.new("RGB", (WIDTH, HEIGHT)))
    segments = build_segments(args, scratch, font)

    frames: list[Image.Image] = []
    durations: list[int] = []
    completed: list[tuple[str, str]] = []

    def emit(extra: tuple[str, str] | None, dur: int) -> None:
        rows = completed + ([extra] if extra is not None else [])
        frames.append(draw_frame(rows, title=args.title, font=font, title_font=title_font))
        durations.append(dur)

    for seg in segments:
        kind = seg["kind"]
        if kind == "gap":
            completed.append(("", "muted"))
        elif kind == "line":
            completed.append((seg["text"], seg["style"]))
            emit(None, LINE_REVEAL_MS)
        elif kind == "cmd":
            text = seg["text"]
            for i in range(1, len(text) + 1, CHARS_PER_FRAME):
                emit((text[:i], "cursor_at"), TYPE_MS)
            for blink in range(2):
                emit((text, "cursor_at" if blink % 2 == 0 else "command"), CURSOR_BLINK_MS)
            completed.append((text, "command"))

    for blink in range(4):
        emit((CURSOR if blink % 2 == 0 else "", "rest"), CURSOR_BLINK_MS)
    durations[-1] = HOLD_MS

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    size = output.stat().st_size
    print(f"wrote {output} ({size / 1024 / 1024:.1f} MB, {len(frames)} frames)")
    if size > 10 * 1024 * 1024:
        print("warning: GIF is over the 10 MB README target", file=sys.stderr)
        return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", required=True, help="Demo language code, e.g. en or ko.")
    parser.add_argument("--source", required=True, help="Source fixture path.")
    parser.add_argument("--rewrite", required=True, help="Expected rewrite fixture path.")
    parser.add_argument("--output", required=True, help="GIF output path.")
    parser.add_argument("--title", default="patina demo", help="Terminal title text.")
    parser.add_argument(
        "--score-line",
        default="✓ score 0%  ·  MPS: meaning preserved",
        help="Final verification line to render.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
