/**
 * MinerU batch API client — TypeScript port of mineru_upload.py.
 * Uploads a local file → polls extraction → downloads result zip → extracts main markdown.
 * Zero Python dependency.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename, extname, join, relative, posix } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";

// ─── Types ──────────────────────────────────────────────────────

export interface MinerUOptions {
  token: string;
  outputDir: string;
  language?: string;
  timeoutMs?: number;
  apiBase?: string;
  signal?: AbortSignal;
}

export interface MinerUSuccess {
  ok: true;
  markdown_path: string;
  images_dir: string;
  chars: number;
}

export interface MinerUFailure {
  ok: false;
  error: string;
}

export type MinerUResult = MinerUSuccess | MinerUFailure;

// ─── Constants ──────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".pptx", ".ppt", ".png", ".jpg", ".jpeg"]);
const DEFAULT_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 2_000;

// ─── Helpers ────────────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[mineru_upload] ${msg}\n`);
}

function sanitizeFilename(text: string): string {
  let sanitized = text.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
  if (!sanitized) return "document";
  return sanitized.slice(0, 120);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Aborted")); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error("Aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function httpJson(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    bodyStr = JSON.stringify(opts.body);
    headers["Content-Type"] ??= "application/json";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const resp = await fetch(url, { method, headers, body: bodyStr, signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${method} ${url}: ${text.slice(0, 800)}`);
    }
    const text = await resp.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ─── API steps ──────────────────────────────────────────────────

function mustSuccess(response: Record<string, unknown>, context: string): Record<string, unknown> {
  const code = response.code;
  if (code !== undefined && code !== null && code !== 0) {
    throw new Error(`${context} failed: ${JSON.stringify(response)}`);
  }
  const data = response.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return response;
}

function firstPresignedUrl(batchData: Record<string, unknown>): string {
  // v4 API: file_urls: ["https://..."]
  const fileUrls = batchData.file_urls;
  if (Array.isArray(fileUrls) && fileUrls.length > 0) {
    const first = fileUrls[0];
    if (typeof first === "string" && first) return first;
  }

  // Fallback: files: [{presigned_url: "..."}]
  const files = batchData.files;
  if (Array.isArray(files) && files.length > 0) {
    const first = files[0];
    if (typeof first === "string" && first) return first;
    if (first && typeof first === "object") {
      for (const key of ["presigned_url", "upload_url", "url"] as const) {
        const value = (first as Record<string, unknown>)[key];
        if (typeof value === "string" && value) return value;
      }
    }
  }

  throw new Error(`Batch response missing presigned/file URL: ${JSON.stringify(batchData)}`);
}

async function createBatch(
  apiBase: string,
  token: string,
  fileName: string,
  language: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ batchId: string; presignedUrl: string }> {
  const endpoint = apiBase.replace(/\/+$/, "") + "/api/v4/file-urls/batch";
  const response = await httpJson("POST", endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      enable_formula: true,
      enable_table: true,
      language,
      files: [{ name: fileName, is_ocr: true }],
    },
    timeoutMs: Math.min(timeoutMs, 120_000),
    signal,
  });
  const data = mustSuccess(response, "create batch");

  const batchId = (data.batch_id ?? response.batch_id) as string | undefined;
  if (!batchId) throw new Error(`Batch response missing batch_id: ${JSON.stringify(response)}`);

  const presignedUrl = firstPresignedUrl(data);
  return { batchId, presignedUrl };
}

async function uploadFile(presignedUrl: string, filePath: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const fileBytes = readFileSync(filePath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    // OSS presigned URLs are signed without Content-Type — do NOT send one
    const resp = await fetch(presignedUrl, {
      method: "PUT",
      body: fileBytes,
      signal: controller.signal,
      // @ts-expect-error duplex required for streaming body in some runtimes
      duplex: "half",
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} PUT upload: ${text.slice(0, 800)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function pollBatch(
  apiBase: string,
  token: string,
  batchId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ extractResult: Record<string, unknown>; zipUrl: string }> {
  const endpoint = apiBase.replace(/\/+$/, "") + `/api/v4/extract-results/batch/${batchId}`;
  const start = Date.now();
  let lastState: string | null = null;

  while (true) {
    const response = await httpJson("GET", endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: Math.min(timeoutMs, 60_000),
      signal,
    });
    const data = mustSuccess(response, "poll batch");

    // Resolve state
    let state = (data.state ?? response.state) as string | undefined;

    const extractResult =
      (data.extract_result ?? data.extract_results ?? response.extract_result ?? response.extract_results) as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined;

    if (!state && Array.isArray(extractResult) && extractResult.length > 0) {
      const itemStates = extractResult
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => item.state as string | undefined)
        .filter(Boolean) as string[];
      if (itemStates.every((s) => s === "done")) state = "done";
      else if (itemStates.some((s) => s === "failed")) state = "failed";
      else if (itemStates.length > 0) state = itemStates[0];
    }

    if (state && state !== lastState) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log(`state=${state} elapsed=${elapsed}s`);
      lastState = state;
    }

    if (state === "done") {
      const items: Record<string, unknown>[] = Array.isArray(extractResult)
        ? extractResult.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        : extractResult && typeof extractResult === "object"
          ? [extractResult]
          : [];

      if (items.length === 0) {
        throw new Error(`Batch done but missing extract_result: ${JSON.stringify(response)}`);
      }

      const chosen = items.find((item) => typeof item.full_zip_url === "string" && item.full_zip_url) ?? items[0];
      const zipUrl = chosen.full_zip_url as string | undefined;
      if (!zipUrl) throw new Error(`Batch done but full_zip_url missing: ${JSON.stringify(chosen)}`);
      return { extractResult: chosen, zipUrl };
    }

    if (state === "failed") {
      const errMsg =
        (data.err_msg ?? response.err_msg ?? data.message ?? response.message) as string | undefined;
      throw new Error(`MinerU batch failed: ${errMsg || "(no err_msg)"}`);
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Poll timeout after ${timeoutMs / 1000}s (last state=${state})`);
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }
}

async function downloadBytes(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} GET ${url}: ${text.slice(0, 800)}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// ─── Zip extraction ─────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else results.push(full);
  }
  return results;
}

async function extractZip(zipBuffer: Buffer, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const zip = await JSZip.loadAsync(zipBuffer);
  const extracted: string[] = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const target = resolve(outDir, name);
    // Security: prevent zip slip
    if (!target.startsWith(resolve(outDir))) {
      throw new Error(`Unsafe zip path: ${name}`);
    }
    mkdirSync(resolve(target, ".."), { recursive: true });
    const content = await entry.async("nodebuffer");
    writeFileSync(target, content);
    extracted.push(target);
  }

  return extracted;
}

function markdownScore(filePath: string): [number, number] {
  const name = basename(filePath).toLowerCase();
  const rel = filePath.replace(/\\/g, "/").toLowerCase();
  let penalty = 0;
  let bonus = 0;

  if (name.includes("readme")) penalty += 3;
  if (/layout|span|debug/.test(rel)) penalty += 3;
  if (/middle|origin/.test(rel)) penalty += 2;
  if (/content|result|output/.test(name)) bonus += 2;

  const size = existsSync(filePath) ? statSync(filePath).size : 0;
  return [bonus - penalty, size];
}

function findMainMarkdown(files: string[]): string {
  const candidates = files.filter((f) => {
    const ext = extname(f).toLowerCase();
    return ext === ".md" || ext === ".markdown";
  });
  if (candidates.length === 0) throw new Error("No markdown file found in MinerU result zip");

  candidates.sort((a, b) => {
    const [aScore, aSize] = markdownScore(a);
    const [bScore, bSize] = markdownScore(b);
    if (bScore !== aScore) return bScore - aScore;
    return bSize - aSize;
  });

  return candidates[0];
}

function copyImages(extractRoot: string, imagesOutDir: string): number {
  let copied = 0;

  function findImageDirs(dir: string): string[] {
    const dirs: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === "images") dirs.push(full);
        dirs.push(...findImageDirs(full));
      }
    }
    return dirs;
  }

  const imageDirs = findImageDirs(extractRoot);
  if (imageDirs.length === 0) return 0;

  mkdirSync(imagesOutDir, { recursive: true });
  for (const srcDir of imageDirs) {
    for (const file of walkDir(srcDir)) {
      const rel = relative(srcDir, file);
      const dst = join(imagesOutDir, rel);
      mkdirSync(resolve(dst, ".."), { recursive: true });
      copyFileSync(file, dst);
      copied++;
    }
  }
  return copied;
}

// ─── Main export ────────────────────────────────────────────────

export async function mineruUpload(filePath: string, opts: MinerUOptions): Promise<MinerUResult> {
  const startMs = Date.now();
  const absPath = resolve(filePath);
  const outputDir = resolve(opts.outputDir);
  const apiBase = opts.apiBase ?? "https://mineru.net";
  const language = opts.language ?? "ch";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = opts.signal;

  if (!existsSync(absPath)) {
    return { ok: false, error: `Input file not found: ${absPath}` };
  }

  const ext = extname(absPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    const supported = [...SUPPORTED_EXTENSIONS].map((e) => e.slice(1)).sort().join(", ");
    return { ok: false, error: `Unsupported file format '${ext}'. Supported: ${supported}` };
  }

  try {
    mkdirSync(outputDir, { recursive: true });
    log(`input=${absPath} output_dir=${outputDir}`);

    // 1. Create batch
    log("creating upload batch");
    const { batchId, presignedUrl } = await createBatch(apiBase, opts.token, basename(absPath), language, timeoutMs, signal);
    log(`batch_id=${batchId}`);

    // 2. Upload file
    log("uploading file to presigned URL");
    await uploadFile(presignedUrl, absPath, Math.min(timeoutMs, 300_000), signal);

    // 3. Poll until done
    log("polling extraction status");
    const { zipUrl } = await pollBatch(apiBase, opts.token, batchId, timeoutMs, signal);

    // 4. Download result zip
    log("downloading result zip");
    const zipBuffer = await downloadBytes(zipUrl, Math.min(timeoutMs, 300_000), signal);

    // 5. Extract zip → find main markdown + images
    const tempExtractDir = join(tmpdir(), `mineru-${sanitizeFilename(batchId)}-${Date.now()}`);
    try {
      const extractedFiles = await extractZip(zipBuffer, tempExtractDir);
      const mainMd = findMainMarkdown(extractedFiles);

      let markdownPath = join(outputDir, `${sanitizeFilename(basename(absPath, ext))}.md`);
      if (existsSync(markdownPath)) {
        markdownPath = join(outputDir, `${sanitizeFilename(basename(absPath, ext))}-${Date.now()}.md`);
      }
      copyFileSync(mainMd, markdownPath);

      const imagesDir = join(outputDir, "images");
      copyImages(tempExtractDir, imagesDir);

      const markdownText = readFileSync(markdownPath, "utf-8").trim();
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      log(`completed batch_id=${batchId} chars=${markdownText.length} elapsed=${elapsed}s`);

      return {
        ok: true,
        markdown_path: markdownPath,
        images_dir: imagesDir,
        chars: markdownText.length,
      };
    } finally {
      // Clean up temp dir
      try {
        const { rmSync } = await import("node:fs");
        rmSync(tempExtractDir, { recursive: true, force: true });
      } catch { /* ignore cleanup errors */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`error: ${msg}`);
    return { ok: false, error: msg };
  }
}
