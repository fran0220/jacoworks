#!/usr/bin/env bash
# Build the golden Pi CLI Desktop VM image for JAcoworks.
# Creates a full Ubuntu Desktop VM with Pi CLI + VNC + noVNC.
#
# Run on the local server (x86_64) where Incus is installed.
# Usage: ./build-pi-vm.sh [--force]

set -euo pipefail

IMAGE_ALIAS="pi-ready"
BUILD_INSTANCE="pi-vm-build-$$"
VNC_PORT=5901
NOVNC_PORT=6080
PI_PORT=18789
LLM_PROXY_URL_DEFAULT="http://67.230.182.59:8317"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PI_CONFIG_DIR="${REPO_ROOT}/pi-config"
PI_WS_WRAPPER_DIR="${REPO_ROOT}/pi-ws-wrapper"
PI_CONFIG_STAGING="$(mktemp -d "${TMPDIR:-/tmp}/pi-config.XXXXXX")"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
    FORCE=true
fi

cleanup() {
    rm -rf "${PI_CONFIG_STAGING}"
    if command -v incus &>/dev/null; then
        if incus info "${BUILD_INSTANCE}" &>/dev/null; then
            incus delete -f "${BUILD_INSTANCE}" >/dev/null 2>&1 || true
        fi
    fi
}
trap cleanup EXIT

prepare_inline_models() {
    cat > "${PI_CONFIG_STAGING}/models.json" <<JSON
{
  "providers": {
    "proxy-anthropic": {
      "baseUrl": "${LLM_PROXY_URL_DEFAULT}",
      "api": "anthropic-messages",
      "apiKey": "LLM_PROXY_KEY",
      "models": [
        {
          "id": "claude-sonnet-4-6",
          "name": "Claude Sonnet 4.6",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "claude-opus-4-6",
          "name": "Claude Opus 4.6",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "claude-haiku-4-5",
          "name": "Claude Haiku 4.5",
          "reasoning": false,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "proxy-openai": {
      "baseUrl": "${LLM_PROXY_URL_DEFAULT}/v1",
      "api": "openai-completions",
      "apiKey": "LLM_PROXY_KEY",
      "models": [
        {
          "id": "gpt-5.3-codex",
          "name": "GPT-5.3 Codex",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "gpt-5.4",
          "name": "GPT-5.4",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "proxy-gemini": {
      "baseUrl": "${LLM_PROXY_URL_DEFAULT}/v1",
      "api": "openai-completions",
      "apiKey": "LLM_PROXY_KEY",
      "models": [
        {
          "id": "gemini-3.1-pro-preview",
          "name": "Gemini 3.1 Pro Preview",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "gemini-3-flash-preview",
          "name": "Gemini 3 Flash Preview",
          "reasoning": false,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "proxy-grok": {
      "baseUrl": "${LLM_PROXY_URL_DEFAULT}/v1",
      "api": "openai-completions",
      "apiKey": "LLM_PROXY_KEY",
      "models": [
        {
          "id": "grok-4.1-fast",
          "name": "Grok 4.1 Fast",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "proxy-glm": {
      "baseUrl": "${LLM_PROXY_URL_DEFAULT}/v1",
      "api": "openai-completions",
      "apiKey": "LLM_PROXY_KEY",
      "models": [
        {
          "id": "glm-5",
          "name": "GLM-5",
          "reasoning": false,
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
JSON
}

prepare_inline_settings() {
    cat > "${PI_CONFIG_STAGING}/settings.json" <<'JSON'
{
  "defaultProvider": "proxy-anthropic",
  "defaultModel": "claude-sonnet-4-6",
  "defaultThinkingLevel": "medium",
  "compaction": {
    "enabled": true,
    "reserveTokens": 32768,
    "keepRecentTokens": 40000
  },
  "extensions": ["./extensions"],
  "skills": ["./skills"]
}
JSON
}

prepare_inline_visual_extension() {
    cat > "${PI_CONFIG_STAGING}/extensions/visual.ts" <<'TS'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

const RenderVisualParams = Type.Object({
  type: StringEnum(["chart", "diagram", "table", "custom"] as const),
  title: Type.Optional(Type.String({ description: "Visual title displayed above the widget" })),
  html: Type.String({
    description:
      "Complete HTML content including inline CSS and JS. For chart type: include Chart.js CDN and canvas setup. For diagram type: include Mermaid CDN and div setup. Must be a self-contained HTML document.",
  }),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "render_visual",
    label: "Render Visual",
    description:
      "Render an interactive visual widget inline in the conversation. Use this when a visual would explain data or concepts better than text.\n\n" +
      "Supported types:\n" +
      "- chart: Use Chart.js (include CDN: https://cdn.jsdelivr.net/npm/chart.js). Create a canvas element.\n" +
      "- diagram: Use Mermaid (include CDN: https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js). Create a div with class=\"mermaid\".\n" +
      "- table: Interactive HTML table with sorting/highlighting. Style with inline CSS.\n" +
      "- custom: Any self-contained HTML/CSS/JS widget.\n\n" +
      "The html field MUST be a complete HTML document (<!DOCTYPE html><html>...) with all CSS/JS inline or from CDN. Keep it concise and focused.",
    promptSnippet:
      "Use when a chart, diagram, table, or custom HTML visual will explain data or concepts better than prose alone.",
    parameters: RenderVisualParams,
    async execute(_toolCallId, params) {
      if (!params.html || params.html.trim().length === 0) {
        return {
          content: [{ type: "text", text: "Error: html content is required" }],
          details: {},
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Visual (${params.type}) rendered successfully.` }],
        details: { type: params.type, title: params.title, html: params.html },
      };
    },
  });
}
TS
}

prepare_inline_cron_extension() {
    cat > "${PI_CONFIG_STAGING}/extensions/cron-proxy.ts" <<'TS'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

const CronManageParams = Type.Object({
  action: StringEnum(["create", "list", "delete", "run", "history"] as const),
  jobId: Type.Optional(Type.String({ description: "Job ID for delete/run/history" })),
  name: Type.Optional(Type.String({ description: "Optional job name" })),
  scheduleKind: Type.Optional(StringEnum(["cron", "at", "every"] as const)),
  schedule: Type.Optional(Type.String({ description: "Cron expression, ISO timestamp, +20m, or 5m" })),
  prompt: Type.Optional(Type.String({ description: "Prompt to execute when the job runs" })),
  sessionTarget: Type.Optional(StringEnum(["main", "isolated"] as const)),
  deleteAfterRun: Type.Optional(Type.Boolean({ description: "Delete job after it runs (default true for at jobs)" })),
  deliveryMode: Type.Optional(StringEnum(["announce", "none"] as const)),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "History result limit" })),
});

function gatewayUrl(): string {
  return (process.env.GATEWAY_URL || process.env.JACOWORKS_GATEWAY_URL || "").replace(/\/$/, "");
}

function gatewayToken(): string {
  return process.env.GATEWAY_TOKEN || process.env.JACOWORKS_GATEWAY_TOKEN || "";
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: {},
    isError: true,
  };
}

async function request(path: string, init: RequestInit = {}) {
  const baseUrl = gatewayUrl();
  const token = gatewayToken();
  if (!baseUrl) throw new Error("GATEWAY_URL is not configured");
  if (!token) throw new Error("GATEWAY_TOKEN is not configured");

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const bodyText = await response.text();
  let body: any = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }
  }

  if (!response.ok) {
    const message = body?.error || body?.message || body?.raw || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function summarizeJob(job: Record<string, unknown>): string {
  const id = String(job.id || "unknown");
  const name = job.name ? ` (${job.name})` : "";
  const enabled = job.enabled === false ? "disabled" : "enabled";
  const prompt = typeof job.prompt === "string" ? job.prompt : "";
  return `${id}${name} ${enabled}${prompt ? ` -> ${prompt}` : ""}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "cron_manage",
    label: "Cron Manager",
    description:
      "Create, list, delete, run, or inspect scheduled jobs through the JAcoworks Gateway cron API.",
    promptSnippet:
      "Use to create, inspect, run, or delete scheduled jobs and to view their execution history.",
    parameters: CronManageParams,
    async execute(_toolCallId, params) {
      try {
        switch (params.action) {
          case "create": {
            if (!params.scheduleKind || !params.schedule || !params.prompt) {
              return errorResult('"scheduleKind", "schedule", and "prompt" are required for create');
            }
            const payload = {
              name: params.name,
              scheduleKind: params.scheduleKind,
              scheduleExpr: params.schedule,
              prompt: params.prompt,
              sessionTarget: params.sessionTarget || "main",
              deleteAfterRun: params.deleteAfterRun,
              deliveryMode: params.deliveryMode,
            };
            const body = await request("/api/cron/jobs", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            return {
              content: [{ type: "text", text: `Created cron job ${summarizeJob(body?.job || body || {})}` }],
              details: body || {},
            };
          }

          case "list": {
            const body = await request("/api/cron/jobs", { method: "GET" });
            const jobs = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body) ? body : [];
            if (jobs.length === 0) {
              return {
                content: [{ type: "text", text: "No cron jobs configured." }],
                details: { jobs: [] },
              };
            }
            return {
              content: [{
                type: "text",
                text: jobs.map((job: Record<string, unknown>) => `- ${summarizeJob(job)}`).join("\n"),
              }],
              details: { jobs },
            };
          }

          case "delete": {
            if (!params.jobId) return errorResult('"jobId" is required for delete');
            const body = await request(`/api/cron/jobs/${encodeURIComponent(params.jobId)}`, {
              method: "DELETE",
            });
            return {
              content: [{ type: "text", text: `Deleted cron job ${params.jobId}` }],
              details: body || { jobId: params.jobId },
            };
          }

          case "run": {
            if (!params.jobId) return errorResult('"jobId" is required for run');
            const body = await request(`/api/cron/jobs/${encodeURIComponent(params.jobId)}/run`, {
              method: "POST",
            });
            return {
              content: [{ type: "text", text: `Triggered cron job ${params.jobId}` }],
              details: body || { jobId: params.jobId },
            };
          }

          case "history": {
            if (!params.jobId) return errorResult('"jobId" is required for history');
            const limit = params.limit || 10;
            const body = await request(
              `/api/cron/jobs/${encodeURIComponent(params.jobId)}/history?limit=${limit}`,
              { method: "GET" },
            );
            const runs = Array.isArray(body?.runs) ? body.runs : Array.isArray(body) ? body : [];
            if (runs.length === 0) {
              return {
                content: [{ type: "text", text: `No history found for job ${params.jobId}.` }],
                details: { runs: [] },
              };
            }
            return {
              content: [{
                type: "text",
                text: runs
                  .map((run: Record<string, unknown>) => {
                    const status = String(run.status || "unknown");
                    const timestamp = String(run.timestamp || run.createdAt || "unknown");
                    const preview = run.resultPreview ? ` -> ${run.resultPreview}` : "";
                    return `- ${timestamp} ${status}${preview}`;
                  })
                  .join("\n"),
              }],
              details: { runs },
            };
          }
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
TS
}

prepare_inline_image_extension() {
    cat > "${PI_CONFIG_STAGING}/extensions/image-gen.ts" <<'TS'
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

const GenerateImageParams = Type.Object({
  prompt: Type.String({ description: "Image description or editing instruction" }),
  filename: Type.String({ description: "Output file path (relative to workspace or absolute)" }),
  input_image: Type.Optional(Type.String({ description: "Path to input image for editing" })),
  aspect_ratio: Type.Optional(StringEnum(["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] as const)),
});

function mimeFromExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return map[ext] || "image/png";
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function generateWithProxy(proxyUrl: string, proxyKey: string, prompt: string, inputImage?: string) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (inputImage) {
    const input = readFileSync(inputImage);
    parts.push({
      inlineData: {
        mimeType: mimeFromExt(inputImage),
        data: input.toString("base64"),
      },
    });
  }

  const response = await fetch(
    `${proxyUrl.replace(/\/$/, "")}/v1beta/models/gemini-3.1-flash-image-preview:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": proxyKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini image generation failed: HTTP ${response.status} ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const encoded = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
  if (!encoded) throw new Error("Gemini image generation returned no image data");
  return Buffer.from(encoded, "base64");
}

async function generateWithFal(falKey: string, prompt: string, inputImage?: string, aspectRatio?: string) {
  const isEdit = Boolean(inputImage);
  const endpoint = isEdit
    ? "https://fal.run/fal-ai/nano-banana-2/edit"
    : "https://fal.run/fal-ai/nano-banana-2";

  const body: Record<string, unknown> = { prompt, num_images: 1 };
  if (isEdit && inputImage) {
    body.image_url = `data:${mimeFromExt(inputImage)};base64,${readFileSync(inputImage).toString("base64")}`;
  } else {
    body.aspect_ratio = aspectRatio || "auto";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`fal.ai generation failed: HTTP ${response.status} ${bodyText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    images?: Array<string | { url?: string }>;
  };
  const image = data.images?.[0];
  if (!image) throw new Error("fal.ai returned no image data");

  if (typeof image === "string") {
    return Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
  }
  if (image.url) {
    return downloadToBuffer(image.url);
  }
  throw new Error("fal.ai returned an unsupported image payload");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate or edit images using Gemini Flash through the shared proxy, with fal.ai as an optional fallback.",
    promptSnippet:
      "Use to create or edit an image file from a prompt when the task needs visual assets or transformed imagery.",
    parameters: GenerateImageParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const proxyUrl = process.env.LLM_PROXY_URL || "http://67.230.182.59:8317";
      const proxyKey = process.env.LLM_PROXY_KEY || "";
      const falKey = process.env.FAL_API_KEY || "";

      if (!proxyKey && !falKey) {
        return {
          content: [{ type: "text", text: "Error: no image generation API key configured (LLM_PROXY_KEY or FAL_API_KEY)" }],
          details: {},
          isError: true,
        };
      }

      const workspace = ctx.cwd || process.cwd();
      const outputPath = resolve(workspace, params.filename);
      const inputPath = params.input_image ? resolve(workspace, params.input_image) : undefined;

      let imageBuffer: Buffer | null = null;
      const failures: string[] = [];

      if (proxyKey) {
        try {
          imageBuffer = await generateWithProxy(proxyUrl, proxyKey, params.prompt, inputPath);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (!imageBuffer && falKey) {
        try {
          imageBuffer = await generateWithFal(falKey, params.prompt, inputPath, params.aspect_ratio);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (!imageBuffer) {
        return {
          content: [{ type: "text", text: `Error: image generation failed. ${failures.join(" | ")}` }],
          details: { failures },
          isError: true,
        };
      }

      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, imageBuffer);

      return {
        content: [{
          type: "text",
          text:
            `Image saved to ${outputPath} (${imageBuffer.length} bytes). ` +
            `Describe the intended result to the user without re-reading the file.`,
        }],
        details: { path: outputPath, size: imageBuffer.length },
      };
    },
  });
}
TS
}

prepare_pi_config_bundle() {
    mkdir -p "${PI_CONFIG_STAGING}/extensions"

    if [[ -f "${PI_CONFIG_DIR}/models.json" ]]; then
        cp "${PI_CONFIG_DIR}/models.json" "${PI_CONFIG_STAGING}/models.json"
    else
        prepare_inline_models
    fi

    if [[ -f "${PI_CONFIG_DIR}/settings.json" ]]; then
        cp "${PI_CONFIG_DIR}/settings.json" "${PI_CONFIG_STAGING}/settings.json"
    else
        prepare_inline_settings
    fi

    if [[ -f "${PI_CONFIG_DIR}/pi-messenger.json" ]]; then
        cp "${PI_CONFIG_DIR}/pi-messenger.json" "${PI_CONFIG_STAGING}/pi-messenger.json"
    fi

    if [[ -f "${PI_CONFIG_DIR}/extensions/visual.ts" ]]; then
        cp "${PI_CONFIG_DIR}/extensions/visual.ts" "${PI_CONFIG_STAGING}/extensions/visual.ts"
    else
        prepare_inline_visual_extension
    fi

    if [[ -f "${PI_CONFIG_DIR}/extensions/cron-proxy.ts" ]]; then
        cp "${PI_CONFIG_DIR}/extensions/cron-proxy.ts" "${PI_CONFIG_STAGING}/extensions/cron-proxy.ts"
    else
        prepare_inline_cron_extension
    fi

    if [[ -f "${PI_CONFIG_DIR}/extensions/image-gen.ts" ]]; then
        cp "${PI_CONFIG_DIR}/extensions/image-gen.ts" "${PI_CONFIG_STAGING}/extensions/image-gen.ts"
    else
        prepare_inline_image_extension
    fi

    if [[ -f "${PI_CONFIG_DIR}/extensions/db0-memory.mjs" ]]; then
        cp "${PI_CONFIG_DIR}/extensions/db0-memory.mjs" "${PI_CONFIG_STAGING}/extensions/db0-memory.mjs"
    fi
}

push_pi_config_bundle() {
    local remote_root="${BUILD_INSTANCE}/home/node/.pi/agent"

    incus file push "${PI_CONFIG_STAGING}/models.json" "${remote_root}/models.json"
    incus file push "${PI_CONFIG_STAGING}/settings.json" "${remote_root}/settings.json"
    if [[ -f "${PI_CONFIG_STAGING}/pi-messenger.json" ]]; then
        incus file push "${PI_CONFIG_STAGING}/pi-messenger.json" "${remote_root}/pi-messenger.json"
    fi

    local extension
    for extension in "${PI_CONFIG_STAGING}"/extensions/*; do
        [[ -f "${extension}" ]] || continue
        case "${extension}" in
            *.ts|*.js|*.mjs) ;;
            *) continue ;;
        esac
        incus file push "${extension}" "${remote_root}/extensions/$(basename "${extension}")"
    done

    incus exec "${BUILD_INSTANCE}" -- bash -c '
set -euo pipefail
mkdir -p /home/node/.pi/agent/skills
chown -R node:node /home/node/.pi
chmod 700 /home/node/.pi /home/node/.pi/agent
'
}

push_pi_ws_wrapper_bundle() {
    local server_path="${PI_WS_WRAPPER_DIR}/server.ts"
    local package_path="${PI_WS_WRAPPER_DIR}/package.json"
    local service_path="${PI_WS_WRAPPER_DIR}/pi-ws-wrapper.service"

    local required_path
    for required_path in "${server_path}" "${package_path}" "${service_path}"; do
        if [[ ! -f "${required_path}" ]]; then
            echo "❌ Missing pi-ws-wrapper asset: ${required_path}"
            exit 1
        fi
    done

    incus file push "${server_path}" "${BUILD_INSTANCE}/opt/pi-ws-wrapper/server.ts"
    incus file push "${package_path}" "${BUILD_INSTANCE}/opt/pi-ws-wrapper/package.json"
    incus file push "${service_path}" "${BUILD_INSTANCE}/etc/systemd/system/pi-ws-wrapper.service"

    incus exec "${BUILD_INSTANCE}" -- bash -c '
set -euo pipefail
chown -R node:node /opt/pi-ws-wrapper
cd /opt/pi-ws-wrapper
runuser -u node -- env HOME=/home/node bun install
'
}

if ! command -v incus &>/dev/null; then
    echo "❌ incus not found"
    exit 1
fi

prepare_pi_config_bundle

if incus image alias list --format csv | grep -q "^${IMAGE_ALIAS},"; then
    if [[ "${FORCE}" == "true" ]]; then
        echo "🗑️  Removing existing image: ${IMAGE_ALIAS}"
        incus image delete "${IMAGE_ALIAS}" 2>/dev/null || true
    else
        echo "✅ Image '${IMAGE_ALIAS}' already exists. Use --force to rebuild."
        exit 0
    fi
fi

echo "📦 Building Pi CLI Desktop VM image..."
echo "   Instance: ${BUILD_INSTANCE}"
echo "   Base: images:ubuntu/24.04 --vm"

# ── 1. Launch VM ──────────────────────────────────────
incus launch images:ubuntu/24.04 "${BUILD_INSTANCE}" --vm \
    -c limits.cpu=4 \
    -c limits.memory=4GiB

echo "⏳ Waiting for VM to boot..."
for _ in $(seq 1 60); do
    if incus exec "${BUILD_INSTANCE}" -- hostname &>/dev/null 2>&1; then
        break
    fi
    sleep 2
done
incus exec "${BUILD_INSTANCE}" -- cloud-init status --wait 2>/dev/null || true
echo "✅ VM booted"

# ── 2. System packages ───────────────────────────────
echo "📥 Installing system packages..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    curl wget git ca-certificates gnupg \
    build-essential jq tmux unzip \
    dbus-x11 xauth
'

# ── 2b. Development & media tools ───────────────────
echo "📥 Installing development & media tools..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq --no-install-recommends \
    python3 python3-pip python3-venv python3-dev \
    pandoc \
    ffmpeg imagemagick poppler-utils \
    zip p7zip-full \
    htop ncdu tree file \
    sqlite3 \
    fonts-liberation fonts-dejavu-core \
    libreoffice-calc libreoffice-writer libreoffice-impress
'

# ── 3. Desktop environment (XFCE, lightweight) ───────
echo "🖥️  Installing XFCE desktop..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq \
    xfce4 xfce4-terminal xfce4-goodies \
    fonts-noto-cjk fonts-noto-color-emoji \
    thunar mousepad ristretto \
    dbus-x11 at-spi2-core
'

# ── 4. VNC server (TigerVNC) ─────────────────────────
echo "📺 Installing TigerVNC..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq tigervnc-standalone-server tigervnc-common
'

# ── 5. noVNC + websockify (browser VNC access) ───────
echo "🌐 Installing noVNC..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq novnc python3-websockify
ln -sf /usr/share/novnc /opt/novnc
'

# ── 6. Node.js 22 ────────────────────────────────────
echo "📥 Installing Node.js 22..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs
'

# ── 6b. Bun runtime ─────────────────────────────────
echo "📥 Installing Bun..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
curl -fsSL https://bun.sh/install | bash
install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
install -m 0755 /root/.bun/bin/bunx /usr/local/bin/bunx
'

# ── 7. Python packages for tools & document support ──
echo "📥 Installing Python packages..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
pip3 install --break-system-packages \
    openpyxl pandas numpy \
    requests beautifulsoup4 lxml \
    python-docx \
    Pillow \
    pyyaml toml \
    markdown \
    chardet \
    feedparser \
    yt-dlp \
    "python-pptx>=0.6.21" \
    "PyMuPDF>=1.23.0" \
    "svglib>=1.5.0" \
    "reportlab>=4.0.0"
'

# ── 8. Global npm tools ──────────────────────────────
echo "📥 Installing global npm tools..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
npm install -g \
    @mariozechner/pi-coding-agent \
    @doufunao123/asset-gateway \
    @larksuite/cli \
    @steipete/bird \
    mcporter
'

# ── 9. Agent Reach + gh CLI ──────────────────────────
echo "📥 Installing internet tools..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
pip3 install --break-system-packages https://github.com/Panniantong/agent-reach/archive/main.zip
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt-get update -qq
apt-get install -y -qq gh
'

# ── 10. Create node user (uid 1000) ──────────────────
echo "👤 Setting up node user..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
if ! id node &>/dev/null; then
    existing_user=$(getent passwd 1000 | cut -d: -f1)
    if [[ -n "${existing_user}" && "${existing_user}" != "node" ]]; then
        usermod -l node -d /home/node -m "${existing_user}"
        groupmod -n node "${existing_user}" 2>/dev/null || true
    else
        useradd -m -s /bin/bash node
    fi
fi
mkdir -p /home/node/.pi/agent/extensions /home/node/.pi/agent/skills /home/node/.local/share /home/node/.npm-global /data/workspace /opt/pi-ws-wrapper
runuser -u node -- env HOME=/home/node npm config set prefix /home/node/.npm-global >/dev/null
cat > /home/node/.npmrc << "EOF_NPMRC"
prefix=/home/node/.npm-global
EOF_NPMRC
grep -qxF 'export PATH=/home/node/.npm-global/bin:$PATH' /home/node/.profile || \
    echo 'export PATH=/home/node/.npm-global/bin:$PATH' >> /home/node/.profile
chown -R node:node /home/node /data /opt/pi-ws-wrapper
'

# ── 11. Install Pi community packages ────────────────
echo "📥 Installing Pi community packages..."
incus exec "${BUILD_INSTANCE}" -- bash -s <<'EOF_PI_PACKAGES'
set -euo pipefail
packages=(
  "pi-messenger"
  "@db0-ai/pi"
  "@db0-ai/backends-postgres"
  "pi-web-access"
  "@apmantza/greedysearch-pi"
  "pi-mcp-adapter"
  "@aliou/pi-guardrails"
  "@aliou/pi-processes"
  "pi-rtk"
)
for package in "${packages[@]}"; do
    if ! runuser -u node -- env \
        HOME=/home/node \
        NPM_CONFIG_PREFIX=/home/node/.npm-global \
        PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin \
        bash -lc "pi list 2>/dev/null | grep -Fq '$package'"; then
        runuser -u node -- env \
            HOME=/home/node \
            NPM_CONFIG_PREFIX=/home/node/.npm-global \
            PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin \
            pi install "npm:${package}"
    fi
done
runuser -u node -- env \
    HOME=/home/node \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    bash -lc 'pi list >/tmp/pi-packages.txt && test -s /tmp/pi-packages.txt && cat /tmp/pi-packages.txt'
EOF_PI_PACKAGES

# ── 12. Deploy Pi config & extensions ────────────────
echo "🔧 Deploying Pi config bundle..."
push_pi_config_bundle

# ── 13. VNC config for node user ─────────────────────
echo "🔧 Configuring VNC..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
mkdir -p /home/node/.vnc
cat > /home/node/.vnc/xstartup << "XSTARTUP"
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11
exec startxfce4
XSTARTUP
chmod +x /home/node/.vnc/xstartup
echo "openclaw" | vncpasswd -f > /home/node/.vnc/passwd
chmod 600 /home/node/.vnc/passwd
chown -R node:node /home/node/.vnc
'

# ── 14. Systemd services ─────────────────────────────
echo "🔧 Creating systemd services..."
incus exec "${BUILD_INSTANCE}" -- bash -c "cat > /etc/systemd/system/vncserver.service << EOF2
[Unit]
Description=TigerVNC Server
After=network-online.target

[Service]
Type=simple
User=node
Group=node
ExecStartPre=/bin/sh -c \"/usr/bin/vncserver -kill :1 2>/dev/null || true\"
ExecStart=/usr/bin/vncserver :1 -geometry 1920x1080 -depth 24 -localhost no -fg
ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=3
Environment=HOME=/home/node

[Install]
WantedBy=multi-user.target
EOF2

cat > /etc/systemd/system/novnc.service << EOF2
[Unit]
Description=noVNC WebSocket Proxy
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
User=node
Group=node
ExecStart=/usr/bin/websockify --web /opt/novnc ${NOVNC_PORT} localhost:${VNC_PORT}
Restart=on-failure
RestartSec=3
Environment=HOME=/home/node

[Install]
WantedBy=multi-user.target
EOF2
"

echo "🔧 Deploying pi-ws-wrapper..."
push_pi_ws_wrapper_bundle

incus exec "${BUILD_INSTANCE}" -- bash -c '
set -euo pipefail
systemctl daemon-reload
systemctl enable vncserver.service novnc.service pi-ws-wrapper.service
'

# ── 15. Verify installations ─────────────────────────
echo "🔍 Verifying installations..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
set -euo pipefail

echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  Bun: $(bun --version)"
echo "  Pi CLI: $(pi --version 2>&1 | head -1)"
echo "  Python: $(python3 --version)"
echo "  pip: $(pip3 --version | cut -d" " -f1-2)"
echo "  ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
echo "  libreoffice: $(libreoffice --version 2>&1 | head -1)"
echo "  imagemagick: $(magick --version 2>&1 | head -1 || convert --version 2>&1 | head -1)"
echo "  poppler: $(pdftotext -v 2>&1 | head -1)"
echo "  pandoc: $(pandoc --version 2>&1 | head -1)"
echo "  sqlite3: $(sqlite3 --version | cut -d" " -f1)"
echo "  asset-gateway: $(asset-gateway --version 2>&1 | head -1 || echo installed)"
echo "  agent-reach: $(agent-reach --version 2>&1 | head -1 || echo installed)"
echo "  yt-dlp: $(yt-dlp --version 2>&1 | head -1)"
echo "  bird: $(bird --version 2>&1 | head -1 || echo installed)"
echo "  mcporter: $(mcporter --version 2>&1 | head -1 || echo installed)"
echo "  lark-cli: $(lark-cli --version 2>&1 | head -1 || echo installed)"
echo "  gh: $(gh --version 2>&1 | head -1)"

python3 - <<"PY"
import bs4
import chardet
import docx
import feedparser
import fitz
import importlib.metadata
import lxml
import markdown
import numpy
import openpyxl
import pandas
import pptx
import reportlab
import requests
import svglib
import toml
import yaml
from PIL import Image

try:
    svglib_version = importlib.metadata.version("svglib")
except importlib.metadata.PackageNotFoundError:
    svglib_version = "unknown"

print(f"  openpyxl: {openpyxl.__version__}")
print(f"  pandas: {pandas.__version__}")
print(f"  requests: {requests.__version__}")
print(f"  beautifulsoup4: {bs4.__version__}")
print(f"  lxml: {lxml.__version__}")
print(f"  python-docx: {docx.__version__}")
print(f"  Pillow: {Image.__version__}")
print(f"  numpy: {numpy.__version__}")
print(f"  python-pptx: {pptx.__version__}")
print(f"  PyMuPDF: {fitz.VersionBind}")
print(f"  svglib: {svglib_version}")
print(f"  reportlab: {reportlab.Version}")
print(f"  pyyaml: {yaml.__version__}")
print(f"  toml: {toml.__version__}")
print(f"  markdown: {markdown.__version__}")
print(f"  chardet: {chardet.__version__}")
print(f"  feedparser: {feedparser.__version__}")
PY

python3 -m json.tool /home/node/.pi/agent/models.json >/dev/null
python3 -m json.tool /home/node/.pi/agent/settings.json >/dev/null
test -f /home/node/.pi/agent/pi-messenger.json
test -f /home/node/.pi/agent/extensions/visual.ts
test -f /home/node/.pi/agent/extensions/cron-proxy.ts
test -f /home/node/.pi/agent/extensions/image-gen.ts
test -f /home/node/.pi/agent/extensions/db0-memory.mjs
test -d /home/node/.pi/agent/skills
runuser -u node -- env HOME=/home/node NPM_CONFIG_PREFIX=/home/node/.npm-global PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    npm config get prefix | grep -qx "/home/node/.npm-global"
installed_packages=$(runuser -u node -- env \
    HOME=/home/node \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    bash -lc "pi list")
test -n "${installed_packages}"
test "${installed_packages}" != "No packages installed."
printf "  Pi packages:\n%s\n" "${installed_packages}"
echo "  pi config dirs: ok"

systemctl cat pi-ws-wrapper.service >/dev/null
systemctl cat pi-ws-wrapper.service | grep -q "/usr/local/bin/bun /opt/pi-ws-wrapper/server.ts"
systemctl cat pi-ws-wrapper.service | grep -q "EnvironmentFile=-/home/node/.pi/agent/runtime.env"
test -f /opt/pi-ws-wrapper/server.ts
test -f /opt/pi-ws-wrapper/package.json
echo "  pi-ws-wrapper service: installed"
'

# ── 16. Clean up ─────────────────────────────────────
echo "🧹 Cleaning up..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
apt-get autoremove -y -qq
apt-get clean
npm cache clean --force
pip3 cache purge || true
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -rf /root/.cache/pip /home/node/.cache/pip /home/node/.npm/_logs
'

# ── 17. Publish image ────────────────────────────────
echo "📸 Stopping VM and publishing as '${IMAGE_ALIAS}'..."
incus stop "${BUILD_INSTANCE}"
incus publish "${BUILD_INSTANCE}" --alias "${IMAGE_ALIAS}" --compression zstd
incus delete "${BUILD_INSTANCE}"

echo ""
echo "✅ Desktop VM image '${IMAGE_ALIAS}' built successfully!"
echo ""
echo "   Image type: VIRTUAL-MACHINE"
echo "   Desktop: XFCE4"
echo "   VNC: TigerVNC :1 (port ${VNC_PORT})"
echo "   noVNC: websockify :${NOVNC_PORT}"
echo "   Pi WS wrapper: Bun service on port ${PI_PORT}"
echo "   Pi config: /home/node/.pi/agent/"
echo "   Preinstalled Python: openpyxl, pandas, requests, python-docx, Pillow, yt-dlp"
echo "   Preinstalled tools: pi, asset-gateway, ffmpeg, ImageMagick, poppler-utils, sqlite3"
echo "   Internet: agent-reach, bird (Twitter), yt-dlp (YouTube/B站), mcporter (MCP), gh CLI"
echo "   Conversion stack: LibreOffice Writer/Calc/Impress"
echo ""
echo "   Test: incus launch ${IMAGE_ALIAS} test-vm --vm -c limits.cpu=2 -c limits.memory=2GiB"
