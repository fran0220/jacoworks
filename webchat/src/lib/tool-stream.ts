import type { StreamBlock } from "../types";

export const TOOL_STREAM_THROTTLE_MS = 80;
const TOOL_OUTPUT_LIMIT = 10000;
type ToolBlock = Extract<StreamBlock, { type: "tool" }>;

export interface ToolStreamEvent {
  kind: "tool_start" | "tool_update" | "tool_end";
  toolId: string;
  toolName: string;
  toolArgs?: unknown;
  toolOutput?: unknown;
  toolError?: string;
}

export interface ToolApplyResult {
  changed: boolean;
  renderDelayMs?: number;
}

function formatOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const asText = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!asText) return undefined;
  if (asText.length <= TOOL_OUTPUT_LIMIT) return asText;
  return `${asText.slice(0, TOOL_OUTPUT_LIMIT)}\n\n… truncated`;
}

function findToolBlock(blocks: StreamBlock[], toolID: string): ToolBlock | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "tool" && block.id === toolID) return block;
  }
  return undefined;
}

export function applyToolEvent(blocks: StreamBlock[], event: ToolStreamEvent): ToolApplyResult {
  let block: ToolBlock | undefined = findToolBlock(blocks, event.toolId);

  if (!block) {
    block = {
      type: "tool",
      id: event.toolId,
      name: event.toolName || "tool",
      status: "running",
      args: event.toolArgs,
    };
    blocks.push(block);
  }

  block.name = event.toolName || block.name;
  if (event.toolArgs !== undefined) block.args = event.toolArgs;

  if (event.kind === "tool_update") {
    const output = formatOutput(event.toolOutput);
    if (output !== undefined) block.output = output;
    block.status = "running";
    return { changed: true, renderDelayMs: TOOL_STREAM_THROTTLE_MS };
  }

  if (event.kind === "tool_end") {
    const output = formatOutput(event.toolOutput);
    if (output !== undefined) block.output = output;
    block.status = event.toolError ? "error" : "completed";
    return { changed: true };
  }

  block.status = "running";
  return { changed: true };
}
