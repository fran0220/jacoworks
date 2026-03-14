import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

// ─── Parameter Schema ───────────────────────────────

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

// ─── Helpers ────────────────────────────────────────

function mimeFromExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  };
  return map[ext] || "image/png";
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Primary: gemini-3.1-flash-image-preview via LLM Proxy (native Gemini API) ──

async function generateWithProxy(
  proxyUrl: string, proxyKey: string,
  prompt: string, inputImage?: string,
): Promise<Buffer> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (inputImage) {
    const imgBuf = readFileSync(inputImage);
    const mime = mimeFromExt(inputImage);
    parts.push({ inlineData: { mimeType: mime, data: imgBuf.toString("base64") } });
  }

  const res = await fetch(
    `${proxyUrl}/v1beta/models/gemini-3.1-flash-image-preview:generateContent`,
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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string } }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  const responseParts = data.candidates?.[0]?.content?.parts;
  const imgPart = responseParts?.find((p) => p.inlineData?.data);
  if (!imgPart?.inlineData) throw new Error("Gemini API: no image in response");

  return Buffer.from(imgPart.inlineData.data, "base64");
}

// ─── Fallback: nano-banana-2 via fal.ai ──

async function generateWithFal(
  falKey: string, prompt: string,
  inputImage?: string, aspectRatio?: string,
): Promise<Buffer> {
  const isEdit = !!inputImage;
  const endpoint = isEdit
    ? "https://fal.run/fal-ai/nano-banana-2/edit"
    : "https://fal.run/fal-ai/nano-banana-2";

  const body: Record<string, unknown> = { prompt, num_images: 1 };
  if (isEdit) {
    const imgBuf = readFileSync(inputImage!);
    const mime = mimeFromExt(inputImage!);
    body.image_url = `data:${mime};base64,${imgBuf.toString("base64")}`;
  } else {
    body.aspect_ratio = aspectRatio || "auto";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal API error: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as { images?: Array<string | { url?: string }> };
  const img = data.images?.[0];
  if (!img) throw new Error("fal API returned no images");

  if (typeof img === "string") {
    return Buffer.from(img.replace(/^data:image\/\w+;base64,/, ""), "base64");
  } else if (img.url) {
    return await downloadToBuffer(img.url);
  }
  throw new Error("fal API: unexpected image format");
}

// ─── Extension Factory ──────────────────────────────

export function createImageGenExtension(
  proxyUrl: string,
  proxyKey: string,
  falKey: string,
  workspaceDir: string,
): ExtensionFactory {
  return (pi) => {
    const tool: ToolDefinition<typeof GenerateImageParams> = {
      name: "generate_image",
      label: "Generate Image",
      description:
        "Generate or edit images using AI. Supports text-to-image and image editing. " +
        "Returns the saved file path. Use for game sprites, UI assets, illustrations, etc.",
      parameters: GenerateImageParams,
      execute: async (_toolCallId, params: Static<typeof GenerateImageParams>) => {
        const outputPath = resolve(workspaceDir, params.filename);
        const inputPath = params.input_image
          ? resolve(workspaceDir, params.input_image)
          : undefined;

        if (!proxyKey && !falKey) {
          return {
            content: [{ type: "text" as const, text: "Error: no image generation API key configured (LLM_PROXY_KEY or FAL_API_KEY)" }],
            details: {},
          };
        }

        let imgBuffer: Buffer | null = null;

        // Primary: gemini via proxy
        if (proxyKey) {
          try {
            imgBuffer = await generateWithProxy(proxyUrl, proxyKey, params.prompt, inputPath);
          } catch (err) {
            console.error(`[image-gen] Proxy failed: ${(err as Error).message}`);
          }
        }

        // Fallback: fal.ai
        if (!imgBuffer && falKey) {
          try {
            imgBuffer = await generateWithFal(falKey, params.prompt, inputPath, params.aspect_ratio);
          } catch (err) {
            console.error(`[image-gen] fal.ai failed: ${(err as Error).message}`);
          }
        }

        if (!imgBuffer) {
          return {
            content: [{ type: "text" as const, text: "Error: all image generation methods failed" }],
            details: {},
          };
        }

        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, imgBuffer);

        return {
          content: [{
            type: "text" as const,
            text: `✅ Image saved: ${outputPath} (${imgBuffer.length} bytes)\nPrompt: "${params.prompt}"\nThe image has been written to disk. Do NOT read it back — describe the result to the user based on the prompt.`,
          }],
          details: { path: outputPath, size: imgBuffer.length },
        };
      },
    };

    pi.registerTool(tool);
  };
}
