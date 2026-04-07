#!/usr/bin/env python3
"""
Local fallback generator for expression sprite sheets when remote sprite provider is unavailable.

Creates 6-frame sheets (768x192) from each pack's ref.png using deterministic motion templates.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "webchat" / "public" / "sprites"

FRAME_W = 128
FRAME_H = 192
FRAMES = 6


def load_subject(ref_path: Path) -> Image.Image:
    ref = Image.open(ref_path).convert("RGBA")
    bbox = ref.getbbox()
    if not bbox:
        return ref.resize((80, 120), Image.Resampling.LANCZOS)
    crop = ref.crop(bbox)
    target_h = 148
    scale = target_h / crop.height
    target_w = max(48, int(crop.width * scale))
    if target_w > 104:
        scale = 104 / crop.width
        target_w = int(crop.width * scale)
        target_h = int(crop.height * scale)
    return crop.resize((target_w, target_h), Image.Resampling.LANCZOS)


def draw_speaking_overlay(draw: ImageDraw.ImageDraw, cx: int, cy: int, frame_idx: int) -> None:
    mouth_open = [2, 6, 8, 4, 7, 3][frame_idx]
    draw.ellipse((cx - 6, cy, cx + 6, cy + mouth_open), fill=(180, 60, 60, 200))


def draw_working_overlay(draw: ImageDraw.ImageDraw, frame_idx: int) -> None:
    x = 76 + frame_idx * 6
    y = 78 + int(3 * math.sin(frame_idx))
    draw.rounded_rectangle((x, y, min(x + 34, 126), y + 20), radius=4, fill=(35, 175, 230, 130))
    draw.line((x + 4, y + 6, min(x + 30, 124), y + 6), fill=(180, 240, 255, 180), width=2)
    draw.line((x + 4, y + 12, min(x + 24, 118), y + 12), fill=(180, 240, 255, 180), width=2)


def draw_happy_overlay(draw: ImageDraw.ImageDraw, frame_idx: int) -> None:
    stars = [(14, 26), (34, 18), (94, 22), (112, 30)]
    pulse = (frame_idx % 2) * 2
    for sx, sy in stars:
        draw.ellipse((sx - 2 - pulse, sy - 2 - pulse, sx + 2 + pulse, sy + 2 + pulse), fill=(255, 220, 80, 210))


def draw_error_overlay(draw: ImageDraw.ImageDraw, frame_idx: int) -> None:
    wobble = int(2 * math.sin(frame_idx))
    qx, qy = 98 + wobble, 22
    draw.text((qx, qy), "?", fill=(240, 70, 70, 230))


def make_frame(subject: Image.Image, expr: str, i: int) -> Image.Image:
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)
    cx = FRAME_W // 2
    base_y = 28

    x_off = 0
    y_off = 0
    angle = 0.0
    scale = 1.0

    if expr == "thinking":
        y_off = int(2.5 * math.sin(i * 0.9))
        angle = -2 + i * 0.8
    elif expr == "speaking":
        y_off = int(2.0 * math.sin(i))
    elif expr == "working":
        y_off = int(1.5 * math.sin(i * 0.8))
        angle = int(1 * math.sin(i))
    elif expr == "happy":
        y_off = -abs(int(8 * math.sin((i + 1) * 0.8)))
        scale = 1.0 + (0.03 if i % 2 == 0 else -0.01)
    elif expr == "error":
        x_off = [-4, 4, -3, 3, -2, 2][i]
        y_off = int(1.0 * math.sin(i))

    w = max(1, int(subject.width * scale))
    h = max(1, int(subject.height * scale))
    sub = subject.resize((w, h), Image.Resampling.LANCZOS)
    if abs(angle) > 0.1:
        sub = sub.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

    px = cx - sub.width // 2 + x_off
    py = base_y + y_off
    frame.alpha_composite(sub, (px, py))

    # Expression-specific overlays.
    if expr == "speaking":
        draw_speaking_overlay(draw, cx, py + int(h * 0.55), i)
    elif expr == "working":
        draw_working_overlay(draw, i)
    elif expr == "happy":
        draw_happy_overlay(draw, i)
    elif expr == "error":
        draw_error_overlay(draw, i)

    return frame


def make_sheet(ref_path: Path, out_path: Path, expr: str) -> None:
    subject = load_subject(ref_path)
    sheet = Image.new("RGBA", (FRAME_W * FRAMES, FRAME_H), (0, 0, 0, 0))
    for i in range(FRAMES):
        f = make_frame(subject, expr, i)
        sheet.alpha_composite(f, (i * FRAME_W, 0))
    sheet.save(out_path, "PNG")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", required=True, help="Comma-separated id:expr list, e.g. lyric:thinking,sage:error")
    args = ap.parse_args()

    items = [x.strip() for x in args.only.split(",") if x.strip()]
    if not items:
        raise SystemExit("No items")

    for item in items:
        if ":" not in item:
            raise SystemExit(f"Bad item: {item}")
        aid, expr = item.split(":", 1)
        aid = aid.strip().lower()
        expr = expr.strip().lower()
        if expr not in {"thinking", "speaking", "working", "happy", "error"}:
            raise SystemExit(f"Unsupported expr: {expr}")

        d = SPRITES / aid
        ref = d / "ref.png"
        out = d / f"{expr}.png"
        if not ref.is_file():
            raise SystemExit(f"Missing ref: {ref}")
        make_sheet(ref, out, expr)
        print(f"[fallback-ok] {aid}/{expr}")


if __name__ == "__main__":
    main()
