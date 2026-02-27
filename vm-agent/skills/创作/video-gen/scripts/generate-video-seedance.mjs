#!/usr/bin/env node
/**
 * Video generation script — Jimeng Seedance 2.0
 *
 * Requires at least one input file (image/video/audio).
 *
 * Usage:
 *   node generate-video-seedance.mjs --prompt "desc @1" --filename "out.mp4" --input-image "photo.png"
 *   node generate-video-seedance.mjs -p "desc @1 @2" -f "out.mp4" -i "a.png" -i "b.png" -d 5 -a 16:9
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_URL       = process.env.JIMENG_API_URL || "http://185.200.65.233:5100";
const API_KEY       = process.env.JIMENG_API_KEY || "";
const MODEL         = "jimeng-video-seedance-2.0";
const POLL_INTERVAL = 3_000;    // 3s
const POLL_TIMEOUT  = 600_000;  // 10min

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const raw = process.argv.slice(2);
  const opts = { inputImages: [] };
  let i = 0;
  while (i < raw.length) {
    const a = raw[i];
    if (a === "--prompt"       || a === "-p") { opts.prompt      = raw[++i]; }
    else if (a === "--filename"     || a === "-f") { opts.filename    = raw[++i]; }
    else if (a === "--input-image"  || a === "-i") { opts.inputImages.push(raw[++i]); }
    else if (a === "--duration"     || a === "-d") { opts.duration    = raw[++i]; }
    else if (a === "--aspect-ratio" || a === "-a") { opts.aspectRatio = raw[++i]; }
    i++;
  }

  if (!opts.prompt)   { console.error("Error: --prompt is required"); process.exit(1); }
  if (!opts.filename) { console.error("Error: --filename is required"); process.exit(1); }
  if (opts.inputImages.length === 0) {
    console.error("Error: --input-image is required (Seedance 2.0 requires at least one file)");
    process.exit(1);
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Multipart submit → task_id
// ---------------------------------------------------------------------------
async function submitTask(opts) {
  const url = `${API_URL}/v1/videos/generations`;
  console.error(`Submitting to Seedance 2.0: ${url}`);

  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", opts.prompt);
  if (opts.duration)    form.append("duration", opts.duration);
  if (opts.aspectRatio) form.append("ratio", opts.aspectRatio);

  for (const filePath of opts.inputImages) {
    const absPath = resolve(filePath);
    const buf = readFileSync(absPath);
    const name = basename(absPath);
    const blob = new Blob([buf]);
    form.append("files", blob, name);
    console.error(`Attached file: ${absPath}`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (res.status !== 202 && !res.ok) {
    const err = await res.text();
    throw new Error(`Submit failed: HTTP ${res.status} — ${err.slice(0, 500)}`);
  }

  const data = await res.json();
  const taskId = data.task?.id;
  if (!taskId) throw new Error(`No task.id in response: ${JSON.stringify(data).slice(0, 500)}`);
  console.error(`Task ID: ${taskId}`);
  return taskId;
}

// ---------------------------------------------------------------------------
// Poll task until succeeded
// ---------------------------------------------------------------------------
async function pollTask(taskId) {
  const url = `${API_URL}/api/v1/tasks/${taskId}`;
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`Poll warning: HTTP ${res.status}`);
      continue;
    }

    const data = await res.json();
    const task = data.task || data;
    const status = task.status;
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    if (status === "succeeded") {
      console.error(`Succeeded after ${elapsed}s`);
      const videoUrl = task.video_url;
      if (!videoUrl) throw new Error(`No video_url in task: ${JSON.stringify(task).slice(0, 500)}`);
      return videoUrl;
    }
    if (status === "failed" || status === "error") {
      throw new Error(`Task failed: ${JSON.stringify(task.error || task)}`);
    }

    console.error(`Status: ${status} (${elapsed}s elapsed)`);
  }

  throw new Error("Poll timeout: exceeded 10 minutes");
}

// ---------------------------------------------------------------------------
// Download video
// ---------------------------------------------------------------------------
async function downloadVideo(url, outputPath) {
  console.error(`Downloading video...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  if (!API_KEY) {
    console.error("Error: JIMENG_API_KEY not configured");
    process.exit(1);
  }

  const outputPath = resolve(opts.filename);

  // Submit
  const taskId = await submitTask(opts);

  // Poll
  const videoUrl = await pollTask(taskId);

  // Download
  const size = await downloadVideo(videoUrl, outputPath);

  // Output path to stdout for agent capture
  console.log(outputPath);
  console.error(`Video saved: ${outputPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
