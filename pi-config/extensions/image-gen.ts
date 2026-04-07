import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_PROXY_URL = "http://67.230.182.59:8317";

const GenerateImageParams = Type.Object({
  prompt: Type.String({ description: "Image description or editing instruction" }),
  filename: Type.String({ description: "Output file path (relative to workspace or absolute)" }),
  input_image: Type.Optional(
    Type.String({ description: "Path to input image for editing (omit for text-to-image)" }),
  ),
  aspect_ratio: Type.Optional(
    Type.String({
      description: "Aspect ratio: auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4",
      default: "auto",
    }),
  ),
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

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function resolveWorkspacePath(cwd: string, filePath: string): string {
  return resolve(cwd, filePath);
}

async function downloadToBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal: withTimeout(signal, 60_000) });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function generateWithProxy(
  proxyUrl: string,
  proxyKey: string,
  prompt: string,
  inputImage?: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (inputImage) {
    const imgBuf = readFileSync(inputImage);
    const mime = mimeFromExt(inputImage);
    parts.push({
      inlineData: {
        mimeType: mime,
        data: imgBuf.toString("base64"),
      },
    });
  }

  const res = await fetch(
    `${proxyUrl.replace(/\/+$/, "")}/v1beta/models/gemini-3.1-flash-image-preview:generateContent`,
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
      signal: withTimeout(signal, 120_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  interface GeminiPart {
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  const responseParts = data.candidates?.[0]?.content?.parts;
  const imgPart = responseParts?.find((part) => part.inlineData?.data);
  if (!imgPart?.inlineData) {
    throw new Error("Gemini API: no image in response");
  }

  return Buffer.from(imgPart.inlineData.data, "base64");
}

async function generateWithFal(
  falKey: string,
  prompt: string,
  inputImage?: string,
  aspectRatio?: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const isEdit = Boolean(inputImage);
  const endpoint = isEdit
    ? "https://fal.run/fal-ai/nano-banana-2/edit"
    : "https://fal.run/fal-ai/nano-banana-2";

  const body: Record<string, unknown> = { prompt, num_images: 1 };
  if (isEdit && inputImage) {
    const imgBuf = readFileSync(inputImage);
    const mime = mimeFromExt(inputImage);
    body.image_url = `data:${mime};base64,${imgBuf.toString("base64")}`;
  } else {
    body.aspect_ratio = aspectRatio || "auto";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal, 120_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal API error: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as { images?: Array<string | { url?: string }> };
  const image = data.images?.[0];
  if (!image) {
    throw new Error("fal API returned no images");
  }
  if (typeof image === "string") {
    return Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
  }
  if (image.url) {
    return downloadToBuffer(image.url, signal);
  }

  throw new Error("fal API: unexpected image format");
}

export default function registerImageGenExtension(pi: ExtensionAPI) {
  const tool = defineTool<typeof GenerateImageParams, Record<string, unknown>>({
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate or edit images using AI. Supports text-to-image and image editing. Returns the saved file path. Use for game sprites, UI assets, illustrations, and similar visual assets.",
    promptSnippet:
      "Use to create or edit an image file from a prompt when the task needs visual assets or transformed imagery.",
    parameters: GenerateImageParams,
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const proxyUrl = process.env.LLM_PROXY_URL?.trim() || DEFAULT_PROXY_URL;
      const proxyKey = process.env.LLM_PROXY_KEY?.trim() || "";
      const falKey = process.env.FAL_API_KEY?.trim() || "";
      const outputPath = resolveWorkspacePath(ctx.cwd, params.filename);
      const inputPath = params.input_image
        ? resolveWorkspacePath(ctx.cwd, params.input_image)
        : undefined;

      if (!proxyKey && !falKey) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: no image generation API key configured (LLM_PROXY_KEY or FAL_API_KEY)",
          }],
          details: {},
        };
      }

      let imageBuffer: Buffer | null = null;

      if (proxyKey) {
        try {
          imageBuffer = await generateWithProxy(proxyUrl, proxyKey, params.prompt, inputPath, signal);
        } catch (error) {
          console.error(`[pi-config/image-gen] proxy failed: ${(error as Error).message}`);
        }
      }

      if (!imageBuffer && falKey) {
        try {
          imageBuffer = await generateWithFal(falKey, params.prompt, inputPath, params.aspect_ratio, signal);
        } catch (error) {
          console.error(`[pi-config/image-gen] fal.ai failed: ${(error as Error).message}`);
        }
      }

      if (!imageBuffer) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: all image generation methods failed",
          }],
          details: {},
        };
      }

      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, imageBuffer);

      return {
        content: [{
          type: "text" as const,
          text:
            `✅ Image saved: ${outputPath} (${imageBuffer.length} bytes)\n` +
            `Prompt: "${params.prompt}"\n` +
            "The image has been written to disk. Do NOT read it back — describe the result to the user based on the prompt.",
        }],
        details: { path: outputPath, size: imageBuffer.length },
      };
    },
  });

  pi.registerTool(tool);
}
