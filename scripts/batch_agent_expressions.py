#!/usr/bin/env python3
"""
Batch-generate non-placeholder expression sprite sheets for all packs under
webchat/public/sprites/<id>/ using asset-gateway generate sprite.

Target outputs per pack:
  thinking.png, speaking.png, working.png, happy.png, error.png

Sheet spec:
  768x192 (6 frames horizontal after resize)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "webchat" / "public" / "sprites"
REPORT_DIR = ROOT / "tasks" / "reports"

EXPRESSIONS = ("thinking", "speaking", "working", "happy", "error")

EXPR_PROMPTS: dict[str, str] = {
    "thinking": (
        "same character as input reference, thinking pose, hand on chin, "
        "eyes looking slightly upward, subtle contemplative motion, smooth seamless loop"
    ),
    "speaking": (
        "same character as input reference, talking animation, mouth opening and closing naturally, "
        "one hand gesturing, friendly delivery, smooth seamless loop"
    ),
    "working": (
        "same character as input reference, focused working motion, interacting with floating interface or tool, "
        "busy but controlled movement, smooth seamless loop"
    ),
    "happy": (
        "same character as input reference, cheerful celebration, slight bounce, arms lifting, "
        "bright positive expression, smooth seamless loop"
    ),
    "error": (
        "same character as input reference, confused reaction, light head scratch gesture, "
        "puzzled expression with slight question-like motion, smooth seamless loop"
    ),
}

# Lightweight role hints to steer motion identity.
ROLE_HINTS: dict[str, str] = {
    "aria": "chief coordinator with holographic badge",
    "nova": "architect with high ponytail and tech goggles",
    "echo": "memory keeper with rune cloak",
    "coda": "full-stack engineer with wrist holographic keyboard",
    "hex": "system hacker with cyber monocle",
    "patch": "repair specialist with glowing wrench",
    "byte": "data engineer with flowing data streams",
    "pixel": "frontend craftsperson with cat-ear headphones",
    "muse": "creative director with artistic scarf",
    "sketch": "visual designer with stylus",
    "lyric": "copywriter with thin-frame glasses",
    "render": "3D artist with AR gloves",
    "chord": "audio engineer with over-ear headphones",
    "atlas": "knowledge explorer with monocle and map pouch",
    "savant": "deep analyst with astrolabe brooch",
    "prism": "data visualization specialist with colorful scarf",
    "oracle": "predictive analyst with constellation robe",
    "shield": "security guardian with energy arm shield",
    "beacon": "monitor sentinel with shoulder drone",
    "forge": "infrastructure builder with welding gloves",
    "sync": "collaboration coordinator with communicator device",
    "tempo": "project scheduler with dual watches",
    "scroll": "document manager with glowing book",
    "link": "API liaison with connecting light beams",
    "vox": "voice interface specialist with sound-wave accessories",
    "lens": "vision recognizer with AR lens",
    "spark": "rapid prototyper with energetic hoodie style",
    "ghost": "background process spirit with translucent cape",
    "rune": "automation script specialist with rune panel",
    "core": "system core entity with chest energy orb",
    "kael": "blue-gold adventurer",
    "luna": "moonlight scholar with silver star robe",
    "ember": "blacksmith artisan with small hammer",
    "iris": "garden spirit with flower crown",
    "zephyr": "cyber walker with raised goggles",
    "yuki": "ice shrine maiden with blue-white palette",
    "rex": "knight guard with red cape",
    "sage": "academy scholar with folding fan",
    "coral": "coastal navigator with telescope",
    "flint": "mine explorer with headlamp",
}


def _run_gateway(cwd: Path, args: list[str]) -> dict:
    r = subprocess.run(
        ["asset-gateway", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env={**os.environ, "PATH": os.environ.get("PATH", "")},
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "").strip()[:600])
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        raise RuntimeError("asset-gateway returned non-JSON output")


def _latest_matching(dir_path: Path, prefix: str) -> Path | None:
    files = sorted(dir_path.glob(f"{prefix}*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files:
        if p.is_file():
            return p
    return None


def _sha12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def _build_prompt(agent_id: str, expr: str) -> str:
    role = ROLE_HINTS.get(agent_id, "same character identity")
    return (
        "Single character, full body, front-facing chibi RPG hand-painted style, "
        "clean transparent background. "
        f"Character identity hint: {role}. "
        f"Action: {EXPR_PROMPTS[expr]}."
    )


def _resize_to_sheet(out_dir: Path, sheet_name: str) -> Path:
    resized = _run_gateway(
        out_dir,
        [
            "process",
            "resize",
            "--input",
            sheet_name,
            "--width",
            "768",
            "--height",
            "192",
            "--output-dir",
            ".",
        ],
    )
    lp = resized.get("data", {}).get("local_path")
    if not lp:
        raise RuntimeError("resize missing local_path")
    return out_dir / lp


def _generate_expr_once(agent_id: str, expr: str) -> tuple[Path, dict]:
    out_dir = SPRITES / agent_id
    prompt = _build_prompt(agent_id, expr)
    res = _run_gateway(
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
            prompt,
            "--output-format",
            "spritesheet",
            "--output-dir",
            ".",
        ],
    )
    local = res.get("data", {}).get("local_path")
    if not local:
        p = _latest_matching(out_dir, "sprite_")
        if not p:
            raise RuntimeError("sprite generation missing local_path and file")
        local = p.name
    sprite_path = out_dir / local
    if not sprite_path.is_file():
        raise RuntimeError(f"generated sprite not found: {local}")

    resized_path = _resize_to_sheet(out_dir, sprite_path.name)
    return resized_path, res


def _cleanup_tmp(out_dir: Path) -> None:
    for pat in ("sprite_*.png", "processed_*.png"):
        for p in out_dir.glob(pat):
            try:
                p.unlink()
            except OSError:
                pass


def should_generate(agent_dir: Path, expr: str, force: bool) -> bool:
    out = agent_dir / f"{expr}.png"
    idle = agent_dir / "idle.png"
    if force:
        return True
    if not out.exists():
        return True
    if not idle.exists():
        return True
    # Placeholder heuristic: expression hash equals idle hash.
    return _sha12(out) == _sha12(idle)


def process_one(agent_id: str, expr: str, retries: int, force: bool, lock: threading.Lock) -> dict:
    out_dir = SPRITES / agent_id
    target = out_dir / f"{expr}.png"
    idle = out_dir / "idle.png"
    rec: dict[str, object] = {
        "agent_id": agent_id,
        "expression": expr,
        "status": "skipped",
        "attempts": 0,
        "target": str(target),
        "started_at": int(time.time()),
    }

    if not out_dir.is_dir():
        rec["status"] = "failed"
        rec["error"] = "missing agent directory"
        return rec
    if not (out_dir / "ref.png").is_file():
        rec["status"] = "failed"
        rec["error"] = "missing ref.png"
        return rec
    if not idle.is_file():
        rec["status"] = "failed"
        rec["error"] = "missing idle.png"
        return rec
    if not should_generate(out_dir, expr, force):
        rec["idle_hash"] = _sha12(idle)
        rec["expr_hash"] = _sha12(target)
        return rec

    last_err = ""
    for attempt in range(1, retries + 1):
        rec["attempts"] = attempt
        t0 = time.time()
        try:
            resized_path, raw = _generate_expr_once(agent_id, expr)
            shutil.move(str(resized_path), str(target))
            _cleanup_tmp(out_dir)
            rec["status"] = "ok"
            rec["elapsed_sec"] = round(time.time() - t0, 2)
            rec["idle_hash"] = _sha12(idle)
            rec["expr_hash"] = _sha12(target)
            rec["same_as_idle"] = rec["idle_hash"] == rec["expr_hash"]
            # keep minimal metadata
            rec["job_id"] = raw.get("data", {}).get("job_id")
            with lock:
                print(f"[ok] {agent_id}/{expr} attempts={attempt} sec={rec['elapsed_sec']}")
            return rec
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            _cleanup_tmp(out_dir)
            with lock:
                print(f"[retry] {agent_id}/{expr} attempt={attempt} err={last_err[:180]}")
            time.sleep(min(8 * attempt, 30))

    rec["status"] = "failed"
    rec["error"] = last_err[:600]
    return rec


def list_agent_ids(only: str) -> list[str]:
    if only.strip():
        return sorted({x.strip().lower() for x in only.split(",") if x.strip()})
    ids = []
    for p in sorted(SPRITES.iterdir()):
        if p.is_dir() and not p.name.startswith("_"):
            ids.append(p.name)
    return ids


def audit(ids: list[str]) -> dict:
    total_targets = 0
    missing = []
    placeholders = []
    for aid in ids:
        d = SPRITES / aid
        idle = d / "idle.png"
        if not idle.is_file():
            missing.append(f"{aid}:idle.png")
            continue
        idle_hash = _sha12(idle)
        for expr in EXPRESSIONS:
            total_targets += 1
            p = d / f"{expr}.png"
            if not p.is_file():
                missing.append(f"{aid}:{expr}.png")
                continue
            if _sha12(p) == idle_hash:
                placeholders.append(f"{aid}:{expr}")
    return {
        "ids": len(ids),
        "targets": total_targets,
        "missing_count": len(missing),
        "placeholder_count": len(placeholders),
        "missing": missing,
        "placeholders": placeholders,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="Comma-separated sprite ids")
    ap.add_argument(
        "--expressions",
        default="thinking,speaking,working,happy,error",
        help="Comma-separated expression names",
    )
    ap.add_argument("--workers", type=int, default=3, help="Parallel workers")
    ap.add_argument("--retries", type=int, default=3, help="Retries per expression")
    ap.add_argument("--force", action="store_true", help="Regenerate all expressions")
    ap.add_argument("--audit-only", action="store_true", help="Only run audit")
    args = ap.parse_args()

    ids = list_agent_ids(args.only)
    exprs = tuple(x.strip() for x in args.expressions.split(",") if x.strip())
    if not ids:
        print("No ids to process", file=sys.stderr)
        sys.exit(2)
    for e in exprs:
        if e not in EXPRESSIONS:
            print(f"Unsupported expression: {e}", file=sys.stderr)
            sys.exit(2)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    if args.audit_only:
        out = audit(ids)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        if out["missing_count"] or out["placeholder_count"]:
            sys.exit(1)
        return

    lock = threading.Lock()
    tasks = [(aid, e) for aid in ids for e in exprs]
    print(f"Start batch: ids={len(ids)} tasks={len(tasks)} workers={args.workers} retries={args.retries}")
    results = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = [ex.submit(process_one, aid, e, args.retries, args.force, lock) for aid, e in tasks]
        for f in as_completed(futs):
            results.append(f.result())

    elapsed = round(time.time() - t0, 2)
    failed = [r for r in results if r.get("status") == "failed"]
    ok = [r for r in results if r.get("status") == "ok"]
    skipped = [r for r in results if r.get("status") == "skipped"]

    summary = {
        "elapsed_sec": elapsed,
        "ids": len(ids),
        "tasks": len(tasks),
        "ok": len(ok),
        "skipped": len(skipped),
        "failed": len(failed),
        "audit": audit(ids),
    }
    ts = int(time.time())
    report = REPORT_DIR / f"agent-expr-batch-{ts}.json"
    report.write_text(
        json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"report={report}")
    if failed or summary["audit"]["missing_count"] or summary["audit"]["placeholder_count"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
