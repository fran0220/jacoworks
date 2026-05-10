import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Type } from "typebox";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { AssetForge } from "@doufunao123/assetforge-sdk";
import type { VideoRequestInput } from "@doufunao123/assetforge-sdk";
import { log } from "../lib/logger.js";

const GenerateVideoParams = Type.Object({
  prompt: Type.String({ description: "Video description or motion instruction" }),
  input_image: Type.Optional(Type.String({
    description: "URL or local file path of a source image to animate (image-to-video). URLs from previous generate_image results can be passed directly.",
  })),
  size: Type.Optional(Type.String({ description: "Output resolution, e.g. '1280x720'" })),
});

export function createVideoGenExtension(apiKey: string, baseUrl?: string): ExtensionFactory {
  const forge = new AssetForge({
    apiKey,
    baseUrl: baseUrl || "https://asset.origingame.dev",
  });

  return (pi) => {
    const tool = defineTool<typeof GenerateVideoParams, Record<string, unknown>>({
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

          if (params.input_image) {
            const isUrl = params.input_image.startsWith("http://") || params.input_image.startsWith("https://");
            if (isUrl) {
              opts.input = params.input_image;
            } else {
              log.info("uploading local image for video", { path: params.input_image });
              const fileData = readFileSync(params.input_image);
              const uploaded = await forge.upload({ data: fileData, filename: basename(params.input_image) });
              opts.input = uploaded.url;
            }
          }

          const result = await forge.video(params.prompt, opts);
          const url = result.url || result.output_url;
          const elapsed = Date.now() - startMs;

          log.info("video generated", { url, provider: result.provider_id, elapsed_ms: elapsed, has_input: !!params.input_image });

          return {
            content: [{ type: "text" as const, text: url ? `Video generated (${result.provider_id}, ${elapsed}ms): ${url}` : "Video generation completed but no URL returned." }],
            details: { url, provider: result.provider_id, elapsed_ms: elapsed, cost_usd: result.cost_usd, mediaType: "video" },
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

    pi.registerTool(tool);
  };
}
