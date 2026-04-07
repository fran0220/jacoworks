#!/usr/bin/env python3
"""
Batch-generate webchat agent sprite refs + idle sheets via asset-gateway.
Resumes: skips agents that already have ref.png and idle.png (use --force to redo).

Static ref image: `asset-gateway generate image --provider gemini` (see asset-gateway
reference/generate.md; default non-transparent image route uses Gemini on the gateway).

Sprite animation: unchanged — `generate sprite` + frame-engine-v1.1 + resize to sheet.

Per tasks/agent-sprites.md + docs/sprite-production-spec.md:
  ref.png   512x768
  idle.png  768x192 (6 frames horizontal, 128x192 per frame after resize)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "webchat" / "public" / "sprites"

# (id, static_prompt, anim_prompt) — static prompts augmented for keying-friendly bg
AGENTS: list[tuple[str, str, str]] = [
    (
        "aria",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Young woman with silver-white short hair, golden pupils, wearing a white high-collar long coat with dark gold circuit-line patterns, a hovering holographic badge on chest. Modern sci-fi aesthetic, warm lighting, clean lines, soft cel-shading.",
        "gentle idle breathing, subtle hair sway, holographic badge pulsing softly, smooth loop",
    ),
    (
        "nova",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Woman with deep blue gradient long hair in a high ponytail, semi-transparent tech goggles on forehead, black trench coat with glowing blue circuit lines. Confident pose, modern sci-fi aesthetic, cool lighting.",
        "idle breathing, ponytail swaying gently, circuit lines pulsing with light, smooth loop",
    ),
    (
        "echo",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with light purple wavy curly hair, faint glowing marks near eyes, grey-white hooded cloak with glowing rune patterns on inner lining. Mysterious yet gentle, soft ethereal lighting.",
        "gentle floating sway, cloak shifting slightly, rune patterns glowing rhythmically, smooth loop",
    ),
    (
        "coda",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Young man with messy brown hair, round glasses, wearing a dark grey hoodie with a backpack, holographic keyboard projection on wrist. Casual tech worker vibe, warm lighting.",
        "idle breathing, fingers twitching slightly near holographic keyboard, smooth loop",
    ),
    (
        "hex",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with black spiky hair with green-dyed tips, dark techwear jacket with many pockets, single-lens cyber monocle glowing green. Edgy hacker aesthetic, cool neon lighting.",
        "subtle idle sway, monocle flickering with data, jacket shifting slightly, smooth loop",
    ),
    (
        "patch",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with orange-red short hair, freckles, wearing a utility vest with multi-pocket tool belt, holding a glowing wrench tool. Friendly mechanic vibe, warm golden lighting.",
        "idle breathing, wrench tool glowing and pulsing, belt pouches swaying slightly, smooth loop",
    ),
    (
        "byte",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with clean black buzz cut, wearing dark turtleneck under white vest, data stream light flowing between fingers. Minimalist and precise, cool blue lighting.",
        "subtle idle motion, data streams flowing between fingers rhythmically, smooth loop",
    ),
    (
        "pixel",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with pink-blue gradient short hair, cat-ear headphones, wearing oversized streetwear t-shirt with cargo pants. Creative and playful vibe, vibrant lighting.",
        "gentle idle bounce, headphone lights pulsing to a beat, smooth loop",
    ),
    (
        "muse",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Woman with wine-red long flowing hair, artist beret hat, wearing beige loose blouse with an artistic scarf. Elegant and creative, warm soft lighting.",
        "idle breathing, hair flowing gently, scarf drifting in breeze, smooth loop",
    ),
    (
        "sketch",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with hair in double buns, paint smudges on face, wearing denim apron over rolled-sleeve white shirt, holding a stylus pen. Artsy and energetic, colorful lighting.",
        "gentle idle sway, stylus twirling slightly in hand, smooth loop",
    ),
    (
        "lyric",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with silver long straight hair, thin-frame glasses, wearing black turtleneck sweater with coffee-brown jacket. Intellectual writer aesthetic, warm amber lighting.",
        "subtle idle breathing, glasses catching light, jacket shifting slightly, smooth loop",
    ),
    (
        "render",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with teal short hair with one side shaved, circuit-pattern tattoo on neck, black techwear suit with AR gloves glowing. Futuristic artist, cool cyan lighting.",
        "idle breathing, AR gloves projecting faint holographic shapes, smooth loop",
    ),
    (
        "chord",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with dark brown dreadlocks, large over-ear headphones around neck, wearing deep purple aviator jacket. Music producer vibe, warm purple-tinted lighting.",
        "gentle idle bob, headphones glowing softly with sound waves, smooth loop",
    ),
    (
        "atlas",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Young person with grey-white hair but youthful face, monocle on one eye, brown leather long coat with map scroll pouch on hip. Explorer-scholar aesthetic, warm adventurous lighting.",
        "idle breathing, monocle glinting, coat swaying gently, smooth loop",
    ),
    (
        "savant",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with dark green short hair, calm composed expression, dark blazer over light blue dress shirt, miniature astrolabe brooch on chest. Professional analyst, cool steady lighting.",
        "subtle idle breathing, astrolabe brooch rotating slowly, smooth loop",
    ),
    (
        "prism",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with rainbow gradient short hair, large round glasses, white lab coat with colorful data-pattern scarf. Vibrant and analytical, prismatic colorful lighting.",
        "gentle idle sway, rainbow scarf shimmering with color shifts, smooth loop",
    ),
    (
        "oracle",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with white ornamental blind eyes (decorative) and a third-eye marking on forehead, wearing deep blue kimono-style tech robe with constellation patterns. Mystical futuristic seer, deep blue ethereal lighting.",
        "gentle floating sway, constellation patterns on robe twinkling, third eye glowing softly, smooth loop",
    ),
    (
        "shield",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Sturdy person with buzz cut, strong jawline, wearing dark grey tactical jacket with bulletproof-vest-style armor plate, energy arm shield. Military-tech guardian, cool steel lighting.",
        "idle breathing, energy shield flickering faintly on arm, steady vigilant pose, smooth loop",
    ),
    (
        "beacon",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with bright yellow short hair, sharp hawk-like eyes, wearing black turtleneck with a small hovering drone companion floating beside shoulder. Alert watchful vibe, warm amber lighting.",
        "subtle idle motion, drone orbiting slowly around shoulder, eyes scanning, smooth loop",
    ),
    (
        "forge",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with brown curly hair in low ponytail, welding goggles pushed up on forehead, heavy-duty work coveralls with glowing tech gloves. Industrial builder vibe, warm forge-orange lighting.",
        "idle breathing, gloves sparking faintly, goggles catching light, smooth loop",
    ),
    (
        "sync",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with split-colored hair (half black half white), ear-mounted communicator device, wearing sleek sporty zip-up jacket, holding a holographic tablet. Dynamic coordinator vibe, balanced warm-cool lighting.",
        "idle breathing, communicator blinking, tablet displaying shifting data, smooth loop",
    ),
    (
        "tempo",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with blue-black short neat hair, two watches on wrist (one physical one holographic), wearing fitted black suit with subtle dark patterns. Precise timekeeper aesthetic, cool blue lighting.",
        "subtle idle motion, holographic watch projecting time display, smooth loop",
    ),
    (
        "scroll",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with brown shoulder-length hair, reading glasses on a chain, wearing camel-colored knit cardigan, cradling a glowing book in arms. Warm librarian-scholar vibe, cozy golden lighting.",
        "gentle idle breathing, book pages glowing and turning slowly, glasses swaying on chain, smooth loop",
    ),
    (
        "link",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with green short hair, friendly warm smile, wearing white polo shirt with tech badge on lanyard, light beams connecting between both hands. Approachable connector vibe, bright clean lighting.",
        "idle breathing, connection beams between hands pulsing rhythmically, smooth loop",
    ),
    (
        "vox",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Woman with golden curly hair, microphone-shaped earrings, wearing mint-green dress with sound wave pattern belt. Voice artist aesthetic, warm lively lighting.",
        "gentle idle sway, sound wave patterns on belt animating, earrings swaying, smooth loop",
    ),
    (
        "lens",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with short hair and single-lens AR glasses with red lens, wearing photographer-style utility vest with multiple camera lens accessories. Sharp observer vibe, focused red-tinted lighting.",
        "subtle idle motion, AR lens scanning with red light sweep, smooth loop",
    ),
    (
        "spark",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with orange spiky hair, energetic excited expression, wearing sporty hoodie with lightning bolt graphic, skater shoes. High-energy prototyper vibe, electric yellow-orange lighting.",
        "lively idle bounce, hoodie strings swaying, energetic micro-movements, smooth loop",
    ),
    (
        "ghost",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with semi-translucent pale grey long hair, dreamy hazy expression, wearing thin gauze-like dark flowing cape that fades at edges. Ethereal background process aesthetic, misty cool lighting.",
        "gentle floating drift, cape edges dissolving and reforming, translucent shimmer, smooth loop",
    ),
    (
        "rune",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with navy blue short hair, glowing rune stickers on forehead, wearing tech jumpsuit with holographic arm panel projections. Automation specialist, neon blue lighting.",
        "idle breathing, rune stickers glowing in sequence, arm panel cycling through code, smooth loop",
    ),
    (
        "core",
        "Single character, full body, front-facing idle pose, solid bright green background. Semi-realistic hand-painted RPG chibi style. Person with pure white hair and glowing pupils, wearing minimalist white bodysuit with a glowing energy orb at chest center. Absolute core system entity, radiant white-blue lighting.",
        "subtle hovering float, energy orb pulsing with power, hair flowing with energy, smooth loop",
    ),
]


def _run_gateway(cwd: Path, args: list[str]) -> dict:
    r = subprocess.run(
        ["asset-gateway", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env={**os.environ, "PATH": os.environ.get("PATH", "")},
    )
    if r.returncode != 0:
        sys.stderr.write(r.stderr or r.stdout or "")
        raise RuntimeError(f"asset-gateway failed ({r.returncode}): {args[:4]}…")
    return json.loads(r.stdout)


def _latest_matching(dir_path: Path, pattern: re.Pattern[str]) -> Path | None:
    matches = sorted(dir_path.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in matches:
        if p.is_file() and pattern.search(p.name):
            return p
    return None


def generate_one(
    agent_id: str,
    static_prompt: str,
    anim_prompt: str,
    force: bool,
    *,
    image_provider: str,
    image_size: str,
    image_model: str | None,
) -> None:
    out_dir = SPRITES / agent_id
    out_dir.mkdir(parents=True, exist_ok=True)
    ref_path = out_dir / "ref.png"
    idle_path = out_dir / "idle.png"

    if not force and ref_path.is_file() and idle_path.is_file():
        print(f"[skip] {agent_id}: ref.png + idle.png exist")
        return

    print(f"[gen] {agent_id} …")

    # 1) Image (Gemini via gateway by default — not 即梦/jimeng)
    if force or not ref_path.is_file():
        img_cmd: list[str] = [
            "generate",
            "image",
            "--provider",
            image_provider,
            "--size",
            image_size,
            "--prompt",
            static_prompt,
            "--output-dir",
            ".",
        ]
        if image_model:
            img_cmd.extend(["--model", image_model])
        _run_gateway(out_dir, img_cmd)
        raw = _latest_matching(out_dir, re.compile(r"^image_"))
        if not raw:
            raise RuntimeError(f"{agent_id}: no image_* from generate image ({image_provider})")
        resized = _run_gateway(
            out_dir,
            [
                "process",
                "resize",
                "--input",
                str(raw.name),
                "--width",
                "512",
                "--height",
                "768",
                "--output-dir",
                ".",
            ],
        )
        lp = resized.get("data", {}).get("local_path")
        if not lp:
            raise RuntimeError(f"{agent_id}: resize missing local_path")
        shutil.move(str(out_dir / lp), str(ref_path))
        # cleanup large raw
        try:
            raw.unlink(missing_ok=True)
        except OSError:
            pass

    # 2) Sprite sheet
    if force or not idle_path.is_file():
        spr = _run_gateway(
            out_dir,
            [
                "generate",
                "sprite",
                "--model",
                "frame-engine-v1.1",
                "--output-frames",
                "6",
                "--input",
                "ref.png",
                "--prompt",
                f"{anim_prompt}, smooth seamless loop animation",
                "--output-format",
                "spritesheet",
                "--output-dir",
                ".",
            ],
        )
        sprite_name = spr.get("data", {}).get("local_path")
        if not sprite_name:
            raise RuntimeError(f"{agent_id}: sprite missing local_path")
        sheet = out_dir / sprite_name
        if not sheet.is_file():
            raise RuntimeError(f"{agent_id}: missing {sprite_name}")

        resized2 = _run_gateway(
            out_dir,
            [
                "process",
                "resize",
                "--input",
                str(sheet.name),
                "--width",
                "768",
                "--height",
                "192",
                "--output-dir",
                ".",
            ],
        )
        lp2 = resized2.get("data", {}).get("local_path")
        if not lp2:
            raise RuntimeError(f"{agent_id}: sprite resize missing local_path")
        shutil.move(str(out_dir / lp2), str(idle_path))
        try:
            sheet.unlink(missing_ok=True)
        except OSError:
            pass

    # Drop stray processed_* if any
    for p in out_dir.glob("processed_*.png"):
        try:
            p.unlink()
        except OSError:
            pass

    print(f"[ok] {agent_id}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--force", action="store_true", help="Regenerate even if outputs exist")
    p.add_argument("--only", type=str, default="", help="Comma-separated agent ids")
    p.add_argument(
        "--image-provider",
        default="gemini",
        help="asset-gateway image provider id (default: gemini)",
    )
    p.add_argument(
        "--image-size",
        default="1024x1792",
        help="Pass-through to generate image --size (default: 1024x1792 portrait)",
    )
    p.add_argument(
        "--image-model",
        default="",
        help="Optional --model for image generation (gateway-specific)",
    )
    args = p.parse_args()
    only = {x.strip().lower() for x in args.only.split(",") if x.strip()}
    image_model = args.image_model.strip() or None

    SPRITES.mkdir(parents=True, exist_ok=True)

    failed: list[str] = []
    for agent_id, static_prompt, anim_prompt in AGENTS:
        if only and agent_id not in only:
            continue
        try:
            generate_one(
                agent_id,
                static_prompt,
                anim_prompt,
                args.force,
                image_provider=args.image_provider.strip(),
                image_size=args.image_size.strip(),
                image_model=image_model,
            )
        except Exception as e:
            print(f"[fail] {agent_id}: {e}", file=sys.stderr)
            failed.append(agent_id)
        time.sleep(1)

    if failed:
        print(f"Done with failures: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)
    print("Done.")


if __name__ == "__main__":
    main()
