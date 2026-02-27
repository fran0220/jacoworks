#!/usr/bin/env node
/**
 * Unified image generation & editing script
 *
 * Primary:  fal-ai/nano-banana-2  (Gemini 3.1 Flash — fast & cheap)
 * Fallback: nano-banana-pro       (Gemini 3 Pro via LLM proxy — highest quality)
 *
 * Usage:
 *   node generate-image.mjs --prompt "description" --filename "output.png"
 *   node generate-image.mjs --prompt "edit" --filename "out.png" --input-image "in.png"
 *   node generate-image.mjs --prompt "desc" --filename "out.png" --aspect-ratio 16:9
 *   node generate-image.mjs --prompt "desc" --filename "out.png" --resolution 4K
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------
const FAL_KEY = process.env.FAL_KEY || "";
const PROXY_URL = (process.env.LLM_PROXY_URL || "http://67.230.171.248:8317").replace(/\/+$/, "");
const PROXY_KEY = process.env.LLM_PROXY_KEY || "";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseCliArgs() {
  const raw = process.argv.slice(2);
  const opts = {};
  let i = 0;
  while (i < raw.length) {
    const arg = raw[i];
    if (arg === "--prompt" || arg === "-p") { opts.prompt = raw[++i]; i++; }
    else if (arg === "--filename" || arg === "-f") { opts.filename = raw[++i]; i++; }
    else if (arg === "--input-image" || arg === "-i") { opts.inputImage = raw[++i]; i++; }
    else if (arg === "--resolution" || arg === "-r") { opts.resolution = raw[++i]; i++; }
    else if (arg === "--aspect-ratio" || arg === "-a") { opts.aspectRatio = raw[++i]; i++; }
    else { i++; }
  }

  if (!opts.prompt) { console.error("Error: --prompt is required"); process.exit(1); }
  if (!opts.filename) { console.error("Error: --filename is required"); process.exit(1); }

  opts.resolution = opts.resolution || "1K";
  if (!["1K", "2K", "4K"].includes(opts.resolution)) {
    console.error(`Error: --resolution must be 1K, 2K, or 4K (got "${opts.resolution}")`);
    process.exit(1);
  }

  // Default aspect ratio: auto (let model decide)
  opts.aspectRatio = opts.aspectRatio || "auto";

  return opts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mimeTypeFromExt(filePath) {
  const ext = extname(filePath).toLowerCase();
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
           ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" }[ext] || "image/png";
}

function autoDetectResolution(filePath) {
  try {
    const buf = readFileSync(filePath);
    let w = 0, h = 0;
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
    } else if (buf[0] === 0xFF && buf[1] === 0xD8) {
      for (let j = 2; j < buf.length - 9; j++) {
        if (buf[j] === 0xFF && (buf[j + 1] === 0xC0 || buf[j + 1] === 0xC2)) {
          h = buf.readUInt16BE(j + 5);
          w = buf.readUInt16BE(j + 7);
          break;
        }
      }
    }
    if (w > 0 && h > 0) {
      const maxDim = Math.max(w, h);
      if (maxDim >= 3000) return "4K";
      if (maxDim >= 1500) return "2K";
    }
  } catch { /* fallback to 1K */ }
  return "1K";
}

async function downloadToBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// fal.ai nano-banana-2 (Primary)
// ---------------------------------------------------------------------------
async function generateWithFal(args) {
  const isEdit = !!args.inputImage;
  const endpoint = isEdit
    ? "https://fal.run/fal-ai/nano-banana-2/edit"
    : "https://fal.run/fal-ai/nano-banana-2";

  const body = { prompt: args.prompt, num_images: 1 };

  if (isEdit) {
    // Encode local image as data URI for fal.ai
    const imgBuffer = readFileSync(args.inputImage);
    const mimeType = mimeTypeFromExt(args.inputImage);
    body.image_url = `data:${mimeType};base64,${imgBuffer.toString("base64")}`;
    console.error(`Loaded input image: ${args.inputImage}`);
  } else {
    body.aspect_ratio = args.aspectRatio;
  }

  console.error(`[fal] ${isEdit ? "Editing" : "Generating"} with nano-banana-2...`);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal API error: HTTP ${res.status} — ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const images = data.images || [];
  if (images.length === 0) {
    throw new Error("fal API returned no images");
  }

  const img = images[0];

  // fal.ai returns { url, content_type, width, height } or base64 string
  if (typeof img === "string") {
    // base64 data URI or raw base64
    const base64Data = img.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64Data, "base64");
  } else if (img.url) {
    // Download from CDN URL
    console.error(`[fal] Downloading from: ${img.url.slice(0, 80)}...`);
    return await downloadToBuffer(img.url);
  }

  throw new Error("fal API: unexpected image format in response");
}

// ---------------------------------------------------------------------------
// nano-banana-pro via LLM Proxy (Fallback)
// ---------------------------------------------------------------------------
async function generateWithProxy(args) {
  const isEdit = !!args.inputImage;
  const parts = [];

  let resolution = args.resolution;
  if (isEdit) {
    const imgBuffer = readFileSync(args.inputImage);
    const mimeType = mimeTypeFromExt(args.inputImage);
    parts.push({ inlineData: { mimeType, data: imgBuffer.toString("base64") } });
    console.error(`Loaded input image: ${args.inputImage}`);
    if (resolution === "1K") {
      resolution = autoDetectResolution(args.inputImage);
      console.error(`Auto-detected resolution: ${resolution}`);
    }
  }

  parts.push({ text: args.prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };
  if (resolution !== "1K") {
    body.generationConfig.imageConfig = { imageSize: resolution };
  }

  const url = `${PROXY_URL}/v1beta/models/nano-banana-pro:generateContent`;
  console.error(`[proxy] ${isEdit ? "Editing" : "Generating"} with nano-banana-pro (${resolution})...`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": PROXY_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Proxy API error: HTTP ${res.status} — ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const candidates = data.candidates || [];
  if (candidates.length === 0) {
    throw new Error("Proxy API: no candidates in response");
  }

  const responseParts = candidates[0].content?.parts || [];
  for (const part of responseParts) {
    if (part.text) console.error(`Model: ${part.text}`);
    if (part.inlineData?.data) {
      return { buffer: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType };
    }
  }

  throw new Error("Proxy API: no image in response");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseCliArgs();

  if (!FAL_KEY && !PROXY_KEY) {
    console.error("Error: neither FAL_KEY nor LLM_PROXY_KEY is set");
    process.exit(1);
  }

  let imgBuffer = null;
  let outputPath = resolve(args.filename);

  // Primary: fal-ai/nano-banana-2
  if (FAL_KEY) {
    try {
      imgBuffer = await generateWithFal(args);
      console.error("[fal] Success");
    } catch (err) {
      console.error(`[fal] Failed: ${err.message}`);
      if (PROXY_KEY) {
        console.error("[fallback] Retrying with nano-banana-pro via proxy...");
      }
    }
  }

  // Fallback: nano-banana-pro via LLM proxy
  if (!imgBuffer && PROXY_KEY) {
    try {
      const result = await generateWithProxy(args);
      imgBuffer = result.buffer;
      // Fix extension if API returned JPEG but user asked for .png
      const actualExt = result.mime === "image/jpeg" ? ".jpg" : ".png";
      const requestedExt = extname(outputPath).toLowerCase();
      if (requestedExt !== actualExt && requestedExt === ".png" && actualExt === ".jpg") {
        outputPath = outputPath.replace(/\.png$/i, ".jpg");
        console.error(`Note: API returned JPEG, saving as ${extname(outputPath)}`);
      }
    } catch (err) {
      console.error(`[proxy] Failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (!imgBuffer) {
    console.error("Error: all generation methods failed");
    process.exit(1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, imgBuffer);
  // stdout: machine-readable path for agent to capture
  console.log(outputPath);
  console.error(`Image saved: ${outputPath} (${imgBuffer.length} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
