#!/usr/bin/env python3
"""Create procedural ref.png / idle.png only where files are missing (512x768 ref, 768x192 idle sheet)."""
from __future__ import annotations

import math
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "webchat" / "public" / "sprites"

# (id, accent hex) — matches sprite-packs registration
AGENT_ACCENTS: list[tuple[str, str]] = [
    ("aria", "#c9a227"),
    ("nova", "#2563eb"),
    ("echo", "#a78bfa"),
    ("coda", "#78716c"),
    ("hex", "#22c55e"),
    ("patch", "#ea580c"),
    ("byte", "#3b82f6"),
    ("pixel", "#ec4899"),
    ("muse", "#9f1239"),
    ("sketch", "#6366f1"),
    ("lyric", "#b45309"),
    ("render", "#0d9488"),
    ("chord", "#7c3aed"),
    ("atlas", "#92400e"),
    ("savant", "#166534"),
    ("prism", "#8b5cf6"),
    ("oracle", "#1e3a8a"),
    ("shield", "#64748b"),
    ("beacon", "#eab308"),
    ("forge", "#c2410c"),
    ("sync", "#64748b"),
    ("tempo", "#1e293b"),
    ("scroll", "#a16207"),
    ("link", "#16a34a"),
    ("vox", "#34d399"),
    ("lens", "#dc2626"),
    ("spark", "#f97316"),
    ("ghost", "#94a3b8"),
    ("rune", "#1d4ed8"),
    ("core", "#e0f2fe"),
]

# Village packs that may ship without idle sheet in static bundle
VILLAGE_IDLE_FALLBACK: list[tuple[str, str]] = [
    ("iris", "#4a8c5c"),
    ("yuki", "#7eb8d0"),
    ("sage", "#4a6b4a"),
    ("flint", "#8b7d3c"),
]


def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.removeprefix("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _darken(rgb: tuple[int, int, int], f: float = 0.55) -> tuple[int, int, int]:
    return tuple(int(c * f) for c in rgb)  # type: ignore[return-value]


def make_ref(agent_id: str, accent: str, out: Path) -> None:
    from PIL import Image, ImageDraw

    w, h = 512, 768
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    top = _hex_rgb(accent)
    bot = _darken(top, 0.45)
    for y in range(h):
        t = y / (h - 1)
        r = int(top[0] * (1 - t) + bot[0] * t)
        g = int(top[1] * (1 - t) + bot[1] * t)
        b = int(top[2] * (1 - t) + bot[2] * t)
        dr.line([(0, y), (w, y)], fill=(r, g, b, 255))
    dr.rounded_rectangle([48, 120, w - 48, h - 80], radius=24, outline=(255, 255, 255, 90), width=3)
    dr.text((w // 2 - 40, 48), agent_id.upper(), fill=(255, 255, 255, 220))
    im.save(out, "PNG")


def make_idle(accent: str, out: Path) -> None:
    from PIL import Image, ImageDraw

    fw, fh = 128, 192
    sheet_w, sheet_h = 768, 192
    top = _hex_rgb(accent)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    for i in range(6):
        frame = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        dr = ImageDraw.Draw(frame)
        shift = int(6 * math.sin(i * 0.8))
        r, g, b = _darken(top, 0.65 + i * 0.04)
        dr.rounded_rectangle([20 + shift, 40, fw - 20 + shift, fh - 24], radius=16, fill=(r, g, b, 255))
        dr.ellipse([fw // 2 - 22 + shift, 28, fw // 2 + 22 + shift, 72], fill=_darken(top, 0.9))
        sheet.paste(frame, (i * fw, 0))
    sheet.save(out, "PNG")


def main() -> None:
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Install Pillow: uv run --with pillow python scripts/fill_agent_sprite_gaps.py", file=sys.stderr)
        sys.exit(2)

    n = 0
    for agent_id, accent in AGENT_ACCENTS:
        d = SPRITES / agent_id
        d.mkdir(parents=True, exist_ok=True)
        ref = d / "ref.png"
        idle = d / "idle.png"
        if not ref.is_file():
            make_ref(agent_id, accent, ref)
            print(f"[fill] {agent_id}/ref.png")
            n += 1
        if not idle.is_file():
            make_idle(accent, idle)
            print(f"[fill] {agent_id}/idle.png")
            n += 1
    print(f"Filled {n} file(s).")

    for agent_id, accent in VILLAGE_IDLE_FALLBACK:
        d = SPRITES / agent_id
        idle = d / "idle.png"
        if d.is_dir() and not idle.is_file():
            make_idle(accent, idle)
            print(f"[village-idle] {agent_id}/idle.png")
            n += 1

    exprs = ("thinking", "speaking", "working", "happy", "error")
    m = 0
    for d in sorted(SPRITES.iterdir()):
        if not d.is_dir():
            continue
        idle = d / "idle.png"
        if not idle.is_file():
            continue
        for ex in exprs:
            p = d / f"{ex}.png"
            if not p.is_file():
                shutil.copy2(idle, p)
                print(f"[expr] {d.name}/{ex}.png")
                m += 1
    if m:
        print(f"Expression placeholders: {m} file(s).")


if __name__ == "__main__":
    main()
