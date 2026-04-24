import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { AssetForge } from "@doufunao123/assetforge-sdk";
import type { ImageOptions, VideoRequestInput } from "@doufunao123/assetforge-sdk";
import { log } from "../lib/logger.js";

// ─── Parameter Schemas ──────────────────────────────

const GenerateImageParams = Type.Object({
  prompt: Type.String({ description: "Image description or editing instruction" }),
  input_image: Type.Optional(Type.String({
    description: "URL or local file path of the source image for editing. URLs from previous generate_image results can be passed directly.",
  })),
  edit_mode: Type.Optional(Type.Union([
    Type.Literal("edit"),
    Type.Literal("inpaint"),
    Type.Literal("restyle"),
    Type.Literal("expand"),
  ], { description: "Editing mode when input_image is provided. Defaults to 'edit'." })),
  size: Type.Optional(Type.String({ description: "Output size, e.g. '1024x1024', '1536x1024'" })),
  transparent: Type.Optional(Type.Boolean({ description: "Generate with transparent background (PNG)" })),
  reference_images: Type.Optional(Type.Array(Type.String(), {
    description: "Reference image URLs for style or content guidance",
  })),
});

// ─── Extension Factory ──────────────────────────────

export function createAssetForgeExtension(apiKey: string, baseUrl?: string): ExtensionFactory {
  const forge = new AssetForge({
    apiKey,
    baseUrl: baseUrl || "https://asset.origingame.dev",
  });

  return (pi) => {
    const imageTools = defineTool<typeof GenerateImageParams, Record<string, unknown>>({
      name: "generate_image",
      label: "Generate Image",
      description:
        "Generate a new image from text, or edit an existing image.\n\n" +
        "For new images: provide a prompt describing the desired image.\n" +
        "For editing: also provide input_image (URL from a previous result, or a local file path) and optionally edit_mode.\n\n" +
        "Returns a URL that can be displayed inline and reused as input_image for further edits.",
      parameters: GenerateImageParams,
      execute: async (_toolCallId, params) => {
        const startMs = Date.now();

        try {
          // Build SDK options
          const opts: ImageOptions = {};
          if (params.size) opts.size = params.size;
          if (params.transparent !== undefined) opts.transparent = params.transparent;
          if (params.reference_images?.length) opts.referenceImages = params.reference_images;

          // Handle input_image: URL passes through, local file needs upload
          if (params.input_image) {
            const isUrl = params.input_image.startsWith("http://") || params.input_image.startsWith("https://");

            if (isUrl) {
              opts.input = params.input_image;
            } else {
              // Local file → upload first
              log.info("uploading local image for editing", { path: params.input_image });
              const fileData = readFileSync(params.input_image);
              const uploaded = await forge.upload(
                { data: fileData, filename: basename(params.input_image) },
              );
              opts.input = uploaded.url;
            }
            opts.editMode = params.edit_mode || "edit";
          }

          const result = await forge.image(params.prompt, opts);
          const url = result.url || result.output_url;
          const elapsed = Date.now() - startMs;

          log.info("image generated", {
            url,
            provider: result.provider_id,
            elapsed_ms: elapsed,
            has_input: !!params.input_image,
          });

          return {
            content: [{
              type: "text" as const,
              text: url
                ? `Image generated (${result.provider_id}, ${elapsed}ms): ${url}`
                : "Image generation completed but no URL returned.",
            }],
            details: {
              url,
              provider: result.provider_id,
              elapsed_ms: elapsed,
              cost_usd: result.cost_usd,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error("image generation failed", { error: message, prompt: params.prompt });
          return {
            content: [{ type: "text" as const, text: `Image generation failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    });

    pi.registerTool(imageTools);

    // ─── generate_video ───────────────────────────────

    const GenerateVideoParams = Type.Object({
      prompt: Type.String({ description: "Video description or motion instruction" }),
      input_image: Type.Optional(Type.String({
        description: "URL or local file path of a source image to animate (image-to-video). URLs from previous generate_image results can be passed directly.",
      })),
      size: Type.Optional(Type.String({ description: "Output resolution, e.g. '1280x720'" })),
    });

    const videoTool = defineTool<typeof GenerateVideoParams, Record<string, unknown>>({
      name: "generate_video",
      label: "Generate Video",
      description:
        "Generate a video from text, or animate an existing image.\n\n" +
        "For text-to-video: provide a prompt describing the desired motion.\n" +
        "For image-to-video: also provide input_image (URL from a generate_image result, or a local file path).\n\n" +
        "Returns a URL to the generated video.",
      parameters: GenerateVideoParams,
      execute: async (_toolCallId, params) => {
        const startMs = Date.now();

        try {
          const opts: Omit<VideoRequestInput, "prompt"> = {};
          if (params.size) opts.size = params.size;

          // Handle input_image: URL passes through, local file needs upload
          if (params.input_image) {
            const isUrl = params.input_image.startsWith("http://") || params.input_image.startsWith("https://");

            if (isUrl) {
              opts.input = params.input_image;
            } else {
              log.info("uploading local image for video", { path: params.input_image });
              const fileData = readFileSync(params.input_image);
              const uploaded = await forge.upload(
                { data: fileData, filename: basename(params.input_image) },
              );
              opts.input = uploaded.url;
            }
          }

          const result = await forge.video(params.prompt, opts);
          const url = result.url || result.output_url;
          const elapsed = Date.now() - startMs;

          log.info("video generated", {
            url,
            provider: result.provider_id,
            elapsed_ms: elapsed,
            has_input: !!params.input_image,
          });

          return {
            content: [{
              type: "text" as const,
              text: url
                ? `Video generated (${result.provider_id}, ${elapsed}ms): ${url}`
                : "Video generation completed but no URL returned.",
            }],
            details: {
              url,
              provider: result.provider_id,
              elapsed_ms: elapsed,
              cost_usd: result.cost_usd,
              mediaType: "video",
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error("video generation failed", { error: message, prompt: params.prompt });
          return {
            content: [{ type: "text" as const, text: `Video generation failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    });

    pi.registerTool(videoTool);
  };
}
