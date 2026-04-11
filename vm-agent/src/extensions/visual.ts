import { Type } from "@sinclair/typebox";
import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent";

// ─── Parameter Schema ───────────────────────────────

const RenderVisualParams = Type.Object({
  type: Type.Union([
    Type.Literal("chart"),
    Type.Literal("diagram"),
    Type.Literal("table"),
    Type.Literal("custom"),
  ], { description: "Visual type: chart (Chart.js), diagram (Mermaid), table, or custom HTML" }),
  title: Type.Optional(Type.String({ description: "Visual title displayed above the widget" })),
  html: Type.Optional(Type.String({ description: "REQUIRED. Complete HTML content including inline CSS and JS. For chart type: include Chart.js CDN and canvas setup. For diagram type: include Mermaid CDN and div setup. Must be a self-contained HTML document." })),
});

// ─── Extension Factory ──────────────────────────────

export function createVisualExtension(): ExtensionFactory {
  return (pi) => {
    const tool = defineTool<typeof RenderVisualParams, Record<string, unknown>>({
      name: "render_visual",
      label: "Render Visual",
      description:
        "Render an interactive visual widget inline in the conversation. Use this when a visual would explain data or concepts better than text.\n\n" +
        "IMPORTANT: The 'html' parameter is REQUIRED — you must always provide it.\n\n" +
        "Supported types:\n" +
        "- chart: Use Chart.js (include CDN: https://cdn.jsdelivr.net/npm/chart.js). Create a canvas element.\n" +
        "- diagram: Use Mermaid (include CDN: https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js). Create a div with class=\"mermaid\".\n" +
        "- table: Interactive HTML table with sorting/highlighting. Style with inline CSS.\n" +
        "- custom: Any self-contained HTML/CSS/JS widget.\n\n" +
        "The html field MUST be a complete HTML document (<!DOCTYPE html><html>...) with all CSS/JS inline or from CDN. Keep it concise and focused.",
      promptSnippet:
        "Use when a chart, diagram, table, or custom HTML visual will explain data or concepts better than prose alone.",
      parameters: RenderVisualParams,
      execute: async (_toolCallId, params) => {
        if (!params.html || params.html.trim().length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: html content is required" }],
            details: {},
          };
        }

        return {
          content: [{ type: "text" as const, text: `Visual (${params.type}) rendered successfully.` }],
          details: { type: params.type, title: params.title, html: params.html },
        };
      },
    });

    pi.registerTool(tool);
  };
}
