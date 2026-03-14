#!/usr/bin/env python3
"""Upload local files to MinerU batch API and export main markdown.

This script is intentionally stdlib-only so it can run in constrained runtimes.
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".png", ".jpg", ".jpeg"}
DEFAULT_TIMEOUT_SEC = 600
DEFAULT_POLL_INTERVAL_SEC = 2.0


def _log(message: str) -> None:
    print(f"[mineru_upload] {message}", file=sys.stderr, flush=True)


def _emit_stdout(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def sanitize_filename(text: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9._-]+", "_", text.strip())
    sanitized = sanitized.strip("._")
    if not sanitized:
        return "document"
    return sanitized[:120]


def _http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict | None = None,
    timeout: int = 60,
) -> dict:
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")

    req = urllib.request.Request(url=url, data=data, method=method.upper(), headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            if not body:
                return {}
            return json.loads(body.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {exc.code} {method.upper()} {url}: {body[:800]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error {method.upper()} {url}: {exc}") from exc


def _http_put_file(url: str, file_path: pathlib.Path, *, timeout: int = 300) -> None:
    data = file_path.read_bytes()
    req = urllib.request.Request(url=url, data=data, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=timeout):
            return
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {exc.code} PUT {url}: {body[:800]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error PUT {url}: {exc}") from exc


def _http_bytes(url: str, *, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url=url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {exc.code} GET {url}: {body[:800]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error GET {url}: {exc}") from exc


def _must_success(response: dict, context: str) -> dict:
    code = response.get("code")
    if code not in (None, 0):
        raise RuntimeError(f"{context} failed: {response}")
    data = response.get("data")
    if isinstance(data, dict):
        return data
    return response


def _first_presigned_url(batch_data: dict) -> str:
    files = batch_data.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError(f"Batch response missing files: {batch_data}")

    first = files[0]
    if not isinstance(first, dict):
        raise RuntimeError(f"Batch response files[0] invalid: {batch_data}")

    for key in ("presigned_url", "upload_url", "url"):
        value = first.get(key)
        if isinstance(value, str) and value:
            return value
    raise RuntimeError(f"Batch response missing presigned_url: {first}")


def create_batch(
    *,
    api_base: str,
    token: str,
    file_name: str,
    language: str,
    timeout_sec: int,
) -> tuple[str, str]:
    endpoint = api_base.rstrip("/") + "/api/v4/file-urls/batch"
    payload = {
        "enable_formula": True,
        "enable_table": True,
        "language": language,
        "files": [{"name": file_name, "is_ocr": True}],
    }
    response = _http_json(
        "POST",
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
        payload=payload,
        timeout=min(timeout_sec, 120),
    )
    data = _must_success(response, "create batch")

    batch_id = data.get("batch_id") or response.get("batch_id")
    if not isinstance(batch_id, str) or not batch_id:
        raise RuntimeError(f"Batch response missing batch_id: {response}")

    presigned_url = _first_presigned_url(data)
    return batch_id, presigned_url


def poll_batch(
    *,
    api_base: str,
    token: str,
    batch_id: str,
    timeout_sec: int,
    poll_interval_sec: float = DEFAULT_POLL_INTERVAL_SEC,
) -> tuple[dict, str]:
    endpoint = api_base.rstrip("/") + f"/api/v4/extract-results/batch/{batch_id}"
    start = time.monotonic()
    last_state = None

    while True:
        response = _http_json(
            "GET",
            endpoint,
            headers={"Authorization": f"Bearer {token}"},
            timeout=min(timeout_sec, 60),
        )
        data = _must_success(response, "poll batch")

        state = data.get("state") or response.get("state")
        if isinstance(state, str) and state != last_state:
            elapsed = time.monotonic() - start
            _log(f"state={state} elapsed={elapsed:.1f}s")
            last_state = state

        if state == "done":
            extract_result = data.get("extract_result")
            if extract_result is None:
                extract_result = data.get("extract_results")
            if extract_result is None:
                extract_result = response.get("extract_result")
            if extract_result is None:
                extract_result = response.get("extract_results")

            if isinstance(extract_result, dict):
                items = [extract_result]
            elif isinstance(extract_result, list):
                items = [item for item in extract_result if isinstance(item, dict)]
            else:
                items = []

            if not items:
                raise RuntimeError(f"Batch done but missing extract_result: {response}")

            chosen = next((item for item in items if isinstance(item.get("full_zip_url"), str) and item.get("full_zip_url")), items[0])
            zip_url = chosen.get("full_zip_url")
            if not isinstance(zip_url, str) or not zip_url:
                raise RuntimeError(f"Batch done but full_zip_url missing: {chosen}")
            return chosen, zip_url

        if state == "failed":
            err_msg = data.get("err_msg") or response.get("err_msg") or data.get("message") or response.get("message")
            raise RuntimeError(f"MinerU batch failed: {err_msg or '(no err_msg)'}")

        if time.monotonic() - start > timeout_sec:
            raise RuntimeError(f"Poll timeout after {timeout_sec}s (last state={state})")

        time.sleep(poll_interval_sec)


def _safe_extract_zip(zip_bytes: bytes, out_dir: pathlib.Path) -> list[pathlib.Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    extracted_files: list[pathlib.Path] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        root = out_dir.resolve()
        for member in zf.infolist():
            target = (out_dir / member.filename).resolve()
            if root not in target.parents and target != root:
                raise RuntimeError(f"Unsafe zip path: {member.filename}")
            zf.extract(member, out_dir)

    for path in out_dir.rglob("*"):
        if path.is_file():
            extracted_files.append(path)
    return extracted_files


def _markdown_score(md_path: pathlib.Path) -> tuple[int, int]:
    name = md_path.name.lower()
    rel = md_path.as_posix().lower()
    penalty = 0
    bonus = 0

    if "readme" in name:
        penalty += 3
    if "layout" in rel or "span" in rel or "debug" in rel:
        penalty += 3
    if "middle" in rel or "origin" in rel:
        penalty += 2
    if "content" in name or "result" in name or "output" in name:
        bonus += 2

    size = md_path.stat().st_size
    return (bonus - penalty, size)


def extract_main_markdown(extracted_files: list[pathlib.Path]) -> pathlib.Path:
    candidates = [p for p in extracted_files if p.suffix.lower() in {".md", ".markdown"}]
    if not candidates:
        raise RuntimeError("No markdown file found in MinerU result zip")
    candidates.sort(key=_markdown_score, reverse=True)
    return candidates[0]


def copy_images(extract_root: pathlib.Path, images_out_dir: pathlib.Path) -> int:
    image_dirs = [p for p in extract_root.rglob("*") if p.is_dir() and p.name.lower() == "images"]
    if not image_dirs:
        return 0

    copied = 0
    images_out_dir.mkdir(parents=True, exist_ok=True)
    for src_dir in image_dirs:
        for src_file in src_dir.rglob("*"):
            if not src_file.is_file():
                continue
            rel = src_file.relative_to(src_dir)
            dst = images_out_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dst)
            copied += 1
    return copied


def run(args: argparse.Namespace) -> dict:
    started = time.monotonic()
    input_path = pathlib.Path(args.file_path).expanduser().resolve()
    output_dir = pathlib.Path(args.output_dir).expanduser().resolve()

    if not input_path.exists() or not input_path.is_file():
        raise RuntimeError(f"Input file not found: {input_path}")

    extension = input_path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(ext.lstrip(".") for ext in SUPPORTED_EXTENSIONS))
        raise RuntimeError(f"Unsupported file format '{extension}'. Supported: {supported}")

    timeout_sec = int(args.timeout)
    if timeout_sec <= 0:
        raise RuntimeError("--timeout must be > 0")

    output_dir.mkdir(parents=True, exist_ok=True)
    _log(f"input={input_path} output_dir={output_dir}")

    _log("creating upload batch")
    batch_id, presigned_url = create_batch(
        api_base=args.api_base,
        token=args.token,
        file_name=input_path.name,
        language=args.language,
        timeout_sec=timeout_sec,
    )
    _log(f"batch_id={batch_id}")

    _log("uploading file to presigned URL")
    _http_put_file(presigned_url, input_path, timeout=min(timeout_sec, 300))

    _log("polling extraction status")
    extract_result, zip_url = poll_batch(
        api_base=args.api_base,
        token=args.token,
        batch_id=batch_id,
        timeout_sec=timeout_sec,
    )

    _log("downloading result zip")
    zip_bytes = _http_bytes(zip_url, timeout=min(timeout_sec, 300))

    with tempfile.TemporaryDirectory(prefix="mineru-upload-") as temp_dir:
        extract_root = pathlib.Path(temp_dir) / sanitize_filename(batch_id)
        extracted_files = _safe_extract_zip(zip_bytes, extract_root)

        main_md = extract_main_markdown(extracted_files)
        markdown_path = output_dir / f"{sanitize_filename(input_path.stem)}.md"
        if markdown_path.exists() and markdown_path.resolve() != main_md.resolve():
            markdown_path = output_dir / f"{sanitize_filename(input_path.stem)}-{int(time.time())}.md"
        shutil.copy2(main_md, markdown_path)

        images_dir = output_dir / "images"
        copied_images = copy_images(extract_root, images_dir)
        if copied_images == 0:
            images_dir = output_dir / "images"

    markdown_text = markdown_path.read_text(encoding="utf-8", errors="replace")
    elapsed = time.monotonic() - started
    _log(f"completed batch_id={batch_id} chars={len(markdown_text)} elapsed={elapsed:.1f}s")
    print(
        json.dumps(
            {
                "batch_id": batch_id,
                "zip_url": zip_url,
                "output_dir": str(output_dir),
                "markdown_path": str(markdown_path),
                "images_dir": str(images_dir),
                "copied_images": copied_images,
                "elapsed_sec": round(elapsed, 3),
            },
            ensure_ascii=False,
        ),
        file=sys.stderr,
    )

    return {
        "ok": True,
        "markdown_path": str(markdown_path),
        "images_dir": str(images_dir),
        "chars": len(markdown_text),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Upload a local file to MinerU batch API and export markdown.")
    parser.add_argument("file_path", help="Path to local input file")
    parser.add_argument("--token", required=True, help="MinerU API token (Bearer token value)")
    parser.add_argument("--output-dir", required=True, help="Directory to write markdown and images")
    parser.add_argument("--language", default="ch", help="MinerU language hint (default: ch)")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC, help="Total timeout seconds (default: 600)")
    parser.add_argument("--api-base", default="https://mineru.net", help="MinerU API base URL")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        result = run(args)
        _emit_stdout(result)
        return 0
    except KeyboardInterrupt:
        _emit_stdout({"ok": False, "error": "Interrupted"})
        return 130
    except Exception as exc:
        _log(f"error: {exc}")
        _emit_stdout({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
