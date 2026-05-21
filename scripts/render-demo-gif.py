#!/usr/bin/env python3
"""Render a small README demo GIF from checked-in text fixtures.

This is an optional asset-generation helper. It keeps README hero demos
reproducible without adding a runtime dependency to the Node package.
Requires Pillow in the local environment:

    python3 -m pip install pillow
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
HEIGHT = 620
PADDING_X = 34
PADDING_TOP = 70
LINE_GAP = 7

COLORS = {
    "page": "#080b16",
    "terminal": "#111827",
    "bar": "#1f2937",
    "text": "#e5e7eb",
    "muted": "#94a3b8",
    "command": "#a7f3d0",
    "before": "#fca5a5",
    "after": "#bfdbfe",
    "pass": "#86efac",
    "dot_red": "#f87171",
    "dot_yellow": "#fbbf24",
    "dot_green": "#34d399",
}


def find_font(size: int, lang: str) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    latin_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ]
    cjk_candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    ]
    candidates = cjk_candidates + latin_candidates if lang in {"ko", "zh", "ja"} else latin_candidates + cjk_candidates
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


def build_lines(args: argparse.Namespace, draw: ImageDraw.ImageDraw, font: ImageFont.ImageFont) -> list[tuple[str, str]]:
    source = Path(args.source).read_text(encoding="utf-8").strip()
    rewrite = Path(args.rewrite).read_text(encoding="utf-8").strip()
    max_width = WIDTH - (PADDING_X * 2)

    def add_wrapped(rows: list[tuple[str, str]], text: str, style: str) -> None:
        for index, line in enumerate(wrap_text(draw, text, font, max_width)):
            rows.append((line if index == 0 else f"  {line}", style))

    rows: list[tuple[str, str]] = []
    add_wrapped(rows, f"$ cat {args.source}", "command")
    rows.extend((line, "before") for line in wrap_text(draw, source, font, max_width))
    rows.append(("", "muted"))
    add_wrapped(rows, f"$ patina --lang {args.lang} --tone marketing {args.source}", "command")
    rows.extend((line, "after") for line in wrap_text(draw, rewrite, font, max_width))
    rows.append(("", "muted"))
    add_wrapped(rows, f"$ node scripts/precommit-score.mjs {args.rewrite}", "command")
    rows.append((args.score_line, "pass"))
    return rows


def draw_frame(
    rows: list[tuple[str, str]],
    visible_rows: int,
    *,
    title: str,
    font: ImageFont.ImageFont,
    title_font: ImageFont.ImageFont,
) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), COLORS["page"])
    draw = ImageDraw.Draw(image)

    # Terminal body.
    left, top, right, bottom = 18, 18, WIDTH - 18, HEIGHT - 18
    draw.rounded_rectangle((left, top, right, bottom), radius=18, fill=COLORS["terminal"])
    draw.rounded_rectangle((left, top, right, top + 42), radius=18, fill=COLORS["bar"])
    draw.rectangle((left, top + 24, right, top + 42), fill=COLORS["bar"])

    # Window controls.
    x = left + 22
    for name in ("dot_red", "dot_yellow", "dot_green"):
        draw.ellipse((x, top + 15, x + 12, top + 27), fill=COLORS[name])
        x += 20

    draw.text((left + 95, top + 12), title, fill=COLORS["muted"], font=title_font)

    line_height = font.size + LINE_GAP if hasattr(font, "size") else 20
    y = PADDING_TOP
    for text, style in rows[:visible_rows]:
        if text:
            draw.text((PADDING_X, y), text, fill=COLORS[style], font=font)
        y += line_height

    return image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", required=True, help="Demo language code, e.g. en or ko.")
    parser.add_argument("--source", required=True, help="Source fixture path.")
    parser.add_argument("--rewrite", required=True, help="Expected rewrite fixture path.")
    parser.add_argument("--output", required=True, help="GIF output path.")
    parser.add_argument("--title", default="patina demo", help="Terminal title text.")
    parser.add_argument(
        "--score-line",
        default="PASS · score under 30% · MPS: meaning preserved",
        help="Final verification line to render.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    font = find_font(17, args.lang)
    title_font = find_font(15, args.lang)
    scratch = Image.new("RGB", (WIDTH, HEIGHT))
    rows = build_lines(args, ImageDraw.Draw(scratch), font)

    frames: list[Image.Image] = []
    durations: list[int] = []
    for visible in range(1, len(rows) + 1):
        frames.append(draw_frame(rows, visible, title=args.title, font=font, title_font=title_font))
        durations.append(220 if visible < len(rows) else 1800)

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
    print(f"wrote {output} ({size / 1024 / 1024:.1f} MB)")
    if size > 10 * 1024 * 1024:
        print("warning: GIF is over the 10 MB README target", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
