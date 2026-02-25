#!/usr/bin/env node
/**
 * Nano Banana Pro image generation & editing — Node.js edition
 * Uses LLM proxy with Gemini-native API format.
 *
 * Usage:
 *   node generate-image.mjs --prompt "description" --filename "output.png"
 *   node generate-image.mjs --prompt "edit" --filename "out.png" --input-image "in.png"
 *   node generate-image.mjs --prompt "desc" --filename "out.png" --resolution 4K
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

// ---------------------------------------------------------------------------
// Config from environment (injected by Tauri → sidecar → env)
// ---------------------------------------------------------------------------
const PROXY_URL = (process.env.LLM_PROXY_URL || "http://67.230.171.248:8317").replace(/\/+$/, "");
const PROXY_KEY = process.env.LLM_PROXY_KEY || "";
const MODEL = "nano-banana-pro";

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
    else { i++; }
  }

  if (!opts.prompt) { console.error("Error: --prompt is required"); process.exit(1); }
  if (!opts.filename) { console.error("Error: --filename is required"); process.exit(1); }
  if (!PROXY_KEY) { console.error("Error: LLM_PROXY_KEY environment variable is required"); process.exit(1); }

  opts.resolution = opts.resolution || "1K";
  if (!["1K", "2K", "4K"].includes(opts.resolution)) {
    console.error(`Error: --resolution must be 1K, 2K, or 4K (got "${opts.resolution}")`);
    process.exit(1);
  }

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
  // Read image dimensions from PNG/JPEG header for auto-resolution
  try {
    const buf = readFileSync(filePath);
    let w = 0, h = 0;
    // PNG: width at offset 16, height at offset 20 (4 bytes each, big-endian)
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
    }
    // JPEG: scan for SOF0 marker (0xFF 0xC0)
    else if (buf[0] === 0xFF && buf[1] === 0xD8) {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseCliArgs();

  // Build parts array
  const parts = [];

  // If editing, include input image first
  let resolution = args.resolution;
  if (args.inputImage) {
    try {
      const imgBuffer = readFileSync(args.inputImage);
      const base64Data = imgBuffer.toString("base64");
      const mimeType = mimeTypeFromExt(args.inputImage);
      parts.push({ inlineData: { mimeType, data: base64Data } });
      console.error(`Loaded input image: ${args.inputImage}`);

      // Auto-detect resolution if user didn't specify (default is 1K)
      if (args.resolution === "1K") {
        resolution = autoDetectResolution(args.inputImage);
        console.error(`Auto-detected resolution: ${resolution}`);
      }
    } catch (err) {
      console.error(`Error loading input image: ${err.message}`);
      process.exit(1);
    }
  }

  // Add text prompt
  parts.push({ text: args.prompt });

  // Build request body (Gemini-native format)
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  // Resolution config — only add if API supports it
  // Note: imageConfig may not be available on all proxy versions
  if (resolution !== "1K") {
    body.generationConfig.imageConfig = { imageSize: resolution };
  }

  const url = `${PROXY_URL}/v1beta/models/${MODEL}:generateContent`;
  console.error(`${args.inputImage ? "Editing" : "Generating"} image (${resolution})...`);

  try {
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
      console.error(`API error: HTTP ${res.status} — ${errText.slice(0, 500)}`);
      process.exit(1);
    }

    const data = await res.json();
    const candidates = data.candidates || [];
    if (candidates.length === 0) {
      console.error("Error: No candidates in response");
      console.error(JSON.stringify(data, null, 2).slice(0, 500));
      process.exit(1);
    }

    const responseParts = candidates[0].content?.parts || [];
    let imageSaved = false;

    for (const part of responseParts) {
      if (part.text) {
        console.error(`Model: ${part.text}`);
      }
      if (part.inlineData?.data) {
        // Determine actual file extension from API response mimeType
        let outputPath = resolve(args.filename);
        const mime = part.inlineData.mimeType || "image/png";
        const actualExt = mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";
        const requestedExt = extname(outputPath).toLowerCase();
        if (requestedExt !== actualExt && requestedExt === ".png" && actualExt === ".jpg") {
          // API returned JPEG but user asked for .png — fix extension
          outputPath = outputPath.replace(/\.png$/i, ".jpg");
          console.error(`Note: API returned JPEG, saving as ${extname(outputPath)}`);
        }

        mkdirSync(dirname(outputPath), { recursive: true });
        const imgBuffer = Buffer.from(part.inlineData.data, "base64");
        writeFileSync(outputPath, imgBuffer);
        imageSaved = true;
        // stdout: machine-readable path for agent to capture
        console.log(outputPath);
        console.error(`Image saved: ${outputPath} (${imgBuffer.length} bytes)`);
      }
    }

    if (!imageSaved) {
      console.error("Error: No image was generated in the response");
      console.error("Response parts:", JSON.stringify(responseParts.map(p => ({ text: p.text, hasImage: !!p.inlineData })), null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
