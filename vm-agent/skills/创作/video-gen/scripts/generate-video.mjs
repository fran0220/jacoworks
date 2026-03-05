#!/usr/bin/env node
/**
 * Video generation script — Kling 3.0 Pro & Google Veo 3.1 via fal.ai queue API
 *
 * Usage:
 *   node generate-video.mjs --model veo31-t2v --prompt "desc" --filename "out.mp4"
 *   node generate-video.mjs --model veo31-i2v --prompt "desc" --filename "out.mp4" --input-image "photo.png"
 *   node generate-video.mjs --model veo31-flf --prompt "desc" --filename "out.mp4" --input-image "start.png" --end-image "end.png"
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
const MODELS = {
  "veo31-t2v":   { endpoint: "fal-ai/veo3.1",                                    type: "t2v", family: "veo" },
  "veo31-i2v":   { endpoint: "fal-ai/veo3.1/image-to-video",                     type: "i2v", family: "veo" },
  "veo31-flf":   { endpoint: "fal-ai/veo3.1/first-last-frame-to-video",          type: "flf", family: "veo" },
  "kling-v3-t2v": { endpoint: "fal-ai/kling-video/v3/pro/text-to-video",         type: "t2v", family: "kling" },
  "kling-v3-i2v": { endpoint: "fal-ai/kling-video/v3/pro/image-to-video",        type: "i2v", family: "kling" },
  "kling-o3-i2v": { endpoint: "fal-ai/kling-video/o3/pro/image-to-video",        type: "flf", family: "kling" },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FAL_KEY = process.env.FAL_API_KEY || "";
const QUEUE_BASE = "https://queue.fal.run";
const POLL_INTERVAL = 3_000;   // 3s
const POLL_TIMEOUT  = 600_000; // 10min

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const raw = process.argv.slice(2);
  const opts = {};
  let i = 0;
  while (i < raw.length) {
    const a = raw[i];
    if (a === "--prompt"       || a === "-p") { opts.prompt      = raw[++i]; }
    else if (a === "--filename"     || a === "-f") { opts.filename    = raw[++i]; }
    else if (a === "--model"        || a === "-m") { opts.model       = raw[++i]; }
    else if (a === "--input-image"  || a === "-i") { opts.inputImage  = raw[++i]; }
    else if (a === "--end-image"    || a === "-e") { opts.endImage    = raw[++i]; }
    else if (a === "--duration"     || a === "-d") { opts.duration    = raw[++i]; }
    else if (a === "--aspect-ratio" || a === "-a") { opts.aspectRatio = raw[++i]; }
    else if (a === "--resolution"   || a === "-r") { opts.resolution  = raw[++i]; }
    else if (a === "--audio")                      { opts.audio       = raw[++i]; }
    i++;
  }

  if (!opts.model)    { console.error("Error: --model is required"); process.exit(1); }
  if (!opts.prompt)   { console.error("Error: --prompt is required"); process.exit(1); }
  if (!opts.filename) { console.error("Error: --filename is required"); process.exit(1); }

  const modelDef = MODELS[opts.model];
  if (!modelDef) {
    console.error(`Error: unknown model "${opts.model}". Available: ${Object.keys(MODELS).join(", ")}`);
    process.exit(1);
  }

  // Validate images
  if (modelDef.type === "i2v" && !opts.inputImage) {
    console.error("Error: --input-image is required for image-to-video models");
    process.exit(1);
  }
  if (modelDef.type === "flf" && (!opts.inputImage || !opts.endImage)) {
    console.error("Error: --input-image and --end-image are required for first-last-frame models");
    process.exit(1);
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Image → data URI
// ---------------------------------------------------------------------------
function imageToDataUri(filePath) {
  const buf = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Build request body per model
// ---------------------------------------------------------------------------
function buildBody(opts) {
  const modelDef = MODELS[opts.model];
  const audio = opts.audio !== "off";
  const body = {};

  if (modelDef.family === "veo") {
    body.prompt = opts.prompt;
    body.generate_audio = audio;
    if (opts.duration)    body.duration    = opts.duration;
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
    if (opts.resolution)  body.resolution  = opts.resolution;

    if (modelDef.type === "i2v") {
      body.image_url = imageToDataUri(opts.inputImage);
      console.error(`Loaded input image: ${opts.inputImage}`);
    } else if (modelDef.type === "flf") {
      body.first_image_url = imageToDataUri(opts.inputImage);
      body.last_image_url  = imageToDataUri(opts.endImage);
      console.error(`Loaded start frame: ${opts.inputImage}`);
      console.error(`Loaded end frame: ${opts.endImage}`);
    }
  } else {
    // Kling
    body.prompt = opts.prompt;
    body.generate_audio = audio;
    if (opts.duration)    body.duration     = opts.duration;
    if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;

    if (modelDef.type === "i2v") {
      body.start_image_url = imageToDataUri(opts.inputImage);
      console.error(`Loaded input image: ${opts.inputImage}`);
      if (opts.endImage) {
        body.end_image_url = imageToDataUri(opts.endImage);
        console.error(`Loaded end image: ${opts.endImage}`);
      }
    } else if (modelDef.type === "flf") {
      // kling-o3-i2v
      body.start_image_url = imageToDataUri(opts.inputImage);
      body.end_image_url   = imageToDataUri(opts.endImage);
      console.error(`Loaded start frame: ${opts.inputImage}`);
      console.error(`Loaded end frame: ${opts.endImage}`);
    }
  }

  return body;
}

// ---------------------------------------------------------------------------
// Queue API: submit → poll → result → download
// ---------------------------------------------------------------------------
async function submitToQueue(endpoint, body) {
  const url = `${QUEUE_BASE}/${endpoint}`;
  console.error(`Submitting to queue: ${endpoint}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Queue submit failed: HTTP ${res.status} — ${err.slice(0, 500)}`);
  }

  const data = await res.json();
  if (!data.request_id) throw new Error("Queue submit: no request_id in response");
  console.error(`Request ID: ${data.request_id}`);
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

async function pollStatus(statusUrl) {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const res = await fetch(statusUrl, {
      headers: { "Authorization": `Key ${FAL_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`Poll warning: HTTP ${res.status}`);
      continue;
    }

    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    if (data.status === "COMPLETED") {
      console.error(`Completed after ${elapsed}s`);
      return;
    }
    if (data.status === "FAILED") {
      throw new Error(`Generation failed: ${JSON.stringify(data.error || data)}`);
    }

    console.error(`Status: ${data.status} (${elapsed}s elapsed)`);
  }

  throw new Error("Queue timeout: exceeded 10 minutes");
}

async function getResult(responseUrl) {
  const res = await fetch(responseUrl, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Get result failed: HTTP ${res.status} — ${err.slice(0, 500)}`);
  }

  const data = await res.json();
  const videoUrl = data.video?.url;
  if (!videoUrl) throw new Error(`No video URL in response: ${JSON.stringify(data).slice(0, 500)}`);
  return videoUrl;
}

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

  if (!FAL_KEY) {
    console.error("Error: FAL_API_KEY not configured");
    process.exit(1);
  }

  const modelDef = MODELS[opts.model];
  const body = buildBody(opts);
  const outputPath = resolve(opts.filename);

  // Submit
  const { statusUrl, responseUrl } = await submitToQueue(modelDef.endpoint, body);

  // Poll
  await pollStatus(statusUrl);

  // Get result
  const videoUrl = await getResult(responseUrl);

  // Download
  const size = await downloadVideo(videoUrl, outputPath);

  // Output path to stdout for agent capture
  console.log(outputPath);
  console.error(`Video saved: ${outputPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
