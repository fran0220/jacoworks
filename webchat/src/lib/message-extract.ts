import type { MessageContentItem, StreamBlock } from "../types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toContentItems(value: unknown): MessageContentItem[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [{ type: "text", text }] : [];
  }

  const record = asRecord(value);
  const content = Array.isArray(record.content) ? record.content : value;
  if (!Array.isArray(content)) {
    return [];
  }

  const items: MessageContentItem[] = [];
  for (const item of content) {
    const entry = asRecord(item);
    const type = asString(entry.type).toLowerCase();
    if (!type) continue;

    if (type === "text") {
      const text = asString(entry.text);
      if (text) items.push({ type: "text", text });
      continue;
    }

    if (type === "thinking") {
      const thinking = asString(entry.thinking || entry.text);
      if (thinking) items.push({ type: "thinking", thinking });
      continue;
    }

    if (type === "toolcall" || type === "tool_call") {
      const name = asString(entry.name) || "tool";
      items.push({ type: "toolcall", name, arguments: entry.arguments ?? entry.args });
      continue;
    }

    if (type === "toolresult" || type === "tool_result") {
      const name = asString(entry.name) || undefined;
      const text = asString(entry.text);
      items.push({ type: "toolresult", name, text: text || undefined, output: entry.output });
    }
  }

  return items;
}

export function extractText(value: unknown): string {
  if (typeof value === "string") return value;

  const items = toContentItems(value);
  const text = items
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  return text;
}

export function extractThinking(value: unknown): string {
  const items = toContentItems(value);
  return items
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("\n")
    .trim();
}

export function contentToBlocks(value: unknown): StreamBlock[] {
  const items = toContentItems(value);
  const blocks: StreamBlock[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "text") {
      const last = blocks[blocks.length - 1];
      if (last?.type === "text") {
        last.content += `\n${item.text}`;
      } else {
        blocks.push({ type: "text", content: item.text });
      }
      continue;
    }

    if (item.type === "thinking") {
      blocks.push({ type: "thinking", content: item.thinking });
      continue;
    }

    if (item.type === "toolcall") {
      blocks.push({
        type: "tool",
        id: `tool-${i}`,
        name: item.name,
        status: "running",
        args: item.arguments,
      });
      continue;
    }

    if (item.type === "toolresult") {
      const last = blocks[blocks.length - 1];
      if (last?.type === "tool" && last.status === "running") {
        last.status = "completed";
        if (item.text) last.output = item.text;
      } else {
        blocks.push({
          type: "tool",
          id: `tool-result-${i}`,
          name: item.name || "tool",
          status: "completed",
          output: item.text,
        });
      }
    }
  }

  return blocks;
}

export function streamBlocksToContent(blocks: StreamBlock[]): MessageContentItem[] {
  const items: MessageContentItem[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.content.trim()) items.push({ type: "text", text: block.content });
      continue;
    }
    if (block.type === "thinking") {
      if (block.content.trim()) items.push({ type: "thinking", thinking: block.content });
      continue;
    }
    if (block.type === "tool") {
      items.push({ type: "toolcall", name: block.name, arguments: block.args });
      if (block.output) {
        items.push({ type: "toolresult", name: block.name, text: block.output });
      }
    }
  }
  return items;
}
