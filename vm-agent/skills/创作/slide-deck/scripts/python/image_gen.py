#!/usr/bin/env python3
"""Generate slide images through the JAcoworks LLM proxy.

This vm-agent adaptation intentionally keeps a small surface area:
- Uses `LLM_PROXY_URL` / `LLM_PROXY_KEY`
- Calls the native Gemini image endpoint already used by vm-agent
- Stays independently executable: `python3 image_gen.py ...`
"""

from __future__ import annotations

import argparse
import base64
import mimetypes
import os
import re
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: requests is required. Run: pip install requests")
    sys.exit(1)


DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_IMAGE_MIME = "image/png"
ASPECT_RATIOS = {"auto", "1:1", "16:9", "9:16", "4:3", "3:4"}


def ensure_proxy_url(url: str) -> str:
    value = (url or "").strip().rstrip("/")
    if not value:
        raise ValueError("LLM_PROXY_URL is not set")
    return value


def ensure_proxy_key(key: str) -> str:
    value = (key or "").strip()
    if not value:
        raise ValueError("LLM_PROXY_KEY is not set")
    return value


def infer_extension(mime_type: str) -> str:
    if mime_type == "image/jpeg":
        return ".jpg"
    return mimetypes.guess_extension(mime_type) or ".png"


def slugify_prompt(prompt: str) -> str:
    safe = re.sub(r"[^\w\-\s]+", "", prompt, flags=re.UNICODE).strip().lower()
    safe = re.sub(r"[-\s]+", "-", safe)
    return safe[:40] or "generated-image"


def resolve_output_path(prompt: str, output_dir: str | None, filename: str | None, mime_type: str) -> Path:
    extension = infer_extension(mime_type)
    if filename:
        target = Path(filename)
        if not target.suffix:
            target = target.with_suffix(extension)
        if output_dir and not target.is_absolute():
            target = Path(output_dir) / target
    else:
        base_dir = Path(output_dir) if output_dir else Path.cwd()
        target = base_dir / f"{slugify_prompt(prompt)}{extension}"

    return target


def build_text_prompt(prompt: str, negative_prompt: str | None, aspect_ratio: str) -> str:
    parts = [prompt.strip()]
    if aspect_ratio != "auto":
        parts.append(f"Render for a {aspect_ratio} canvas.")
    if negative_prompt:
        parts.append(f"Avoid: {negative_prompt.strip()}")
    return "\n\n".join(part for part in parts if part)


def build_parts(prompt: str, negative_prompt: str | None, aspect_ratio: str, input_image: str | None) -> list[dict[str, object]]:
    parts: list[dict[str, object]] = [{"text": build_text_prompt(prompt, negative_prompt, aspect_ratio)}]
    if input_image:
        image_path = Path(input_image)
        mime_type, _ = mimetypes.guess_type(image_path.name)
        mime_type = mime_type or DEFAULT_IMAGE_MIME
        parts.append(
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64.b64encode(image_path.read_bytes()).decode("ascii"),
                }
            }
        )
    return parts


def extract_inline_image(payload: dict) -> tuple[bytes, str]:
    candidates = payload.get("candidates") or []
    for candidate in candidates:
        parts = ((candidate.get("content") or {}).get("parts") or [])
        for part in parts:
            inline_data = part.get("inlineData")
            if inline_data and inline_data.get("data"):
                mime_type = inline_data.get("mimeType") or DEFAULT_IMAGE_MIME
                return base64.b64decode(inline_data["data"]), mime_type
    raise RuntimeError("No image was returned by the proxy")


def generate_image(
    prompt: str,
    *,
    negative_prompt: str | None,
    aspect_ratio: str,
    output_dir: str | None,
    filename: str | None,
    input_image: str | None,
    model: str,
    timeout_seconds: int,
) -> Path:
    proxy_url = ensure_proxy_url(os.environ.get("LLM_PROXY_URL", ""))
    proxy_key = ensure_proxy_key(os.environ.get("LLM_PROXY_KEY", ""))

    response = requests.post(
        f"{proxy_url}/v1beta/models/{model}:generateContent",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": proxy_key,
        },
        json={
            "contents": [{"parts": build_parts(prompt, negative_prompt, aspect_ratio, input_image)}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        },
        timeout=timeout_seconds,
    )
    response.raise_for_status()

    image_bytes, mime_type = extract_inline_image(response.json())
    output_path = resolve_output_path(prompt, output_dir, filename, mime_type)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image_bytes)
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate images with the JAcoworks LLM proxy")
    parser.add_argument("prompt", nargs="?", default="a modern presentation illustration")
    parser.add_argument("--negative_prompt", "-n", default=None)
    parser.add_argument("--aspect_ratio", default="1:1", choices=sorted(ASPECT_RATIOS))
    parser.add_argument("--image_size", default="1K", help="Accepted for CLI compatibility; currently informational only")
    parser.add_argument("--output", "-o", default=None, help="Output directory")
    parser.add_argument("--filename", "-f", default=None, help="Output filename")
    parser.add_argument("--input-image", dest="input_image", default=None, help="Optional input image for editing")
    parser.add_argument("--model", "-m", default=DEFAULT_MODEL)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--list-backends", action="store_true")
    args = parser.parse_args()

    if args.list_backends:
        print("proxy-gemini\tgemini-3.1-flash-image-preview via LLM_PROXY_URL/LLM_PROXY_KEY")
        return

    try:
        output_path = generate_image(
            args.prompt,
            negative_prompt=args.negative_prompt,
            aspect_ratio=args.aspect_ratio,
            output_dir=args.output,
            filename=args.filename,
            input_image=args.input_image,
            model=args.model,
            timeout_seconds=args.timeout,
        )
    except Exception as exc:
        print(f"Error: {exc}")
        sys.exit(1)

    print(f"Saved image to: {output_path}")


if __name__ == "__main__":
    main()
