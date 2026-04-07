import { extractFileArtifact } from "../../lib/file-artifacts";
import type { ParsedEvent } from "../../lib/event-parser";
import { contentToBlocks } from "../../lib/message-extract";
import type { ChatMessage, FileArtifact, StreamBlock } from "../../types";

function asContentSource(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const rec = message as Record<string, unknown>;
  if (Array.isArray(rec.content)) return rec.content;
  if (typeof rec.text === "string") return [{ type: "text", text: rec.text }];
  return message;
}

export function isContentEvent(event: ParsedEvent): boolean {
  return (
    event.kind === "text_delta" ||
    event.kind === "chat_delta" ||
    event.kind === "thinking_start" ||
    event.kind === "thinking_delta" ||
    event.kind === "tool_start" ||
    event.kind === "tool_update"
  );
}

export function mergeArtifacts(
  ...groups: Array<FileArtifact[] | undefined>
): FileArtifact[] | undefined {
  const merged: FileArtifact[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const artifact of group) {
      if (merged.some((item) => item.id === artifact.id)) continue;
      merged.push(artifact);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

export function collectArtifacts(
  blocks: StreamBlock[],
): FileArtifact[] | undefined {
  const artifacts = blocks
    .filter(
      (block): block is Extract<StreamBlock, { type: "tool" }> =>
        block.type === "tool",
    )
    .map((block) => block.artifact || extractFileArtifact(block.output))
    .filter((artifact): artifact is FileArtifact => Boolean(artifact));
  return mergeArtifacts(artifacts);
}

export function extractFinalMessageMeta(
  message: unknown,
): Pick<ChatMessage, "sender" | "type" | "orchestration" | "artifacts"> {
  if (!message || typeof message !== "object") return {};

  const rec = message as Record<string, unknown>;
  const sender = rec.sender;
  const orchestration = rec.orchestration;
  const type = rec.type;
  const senderRecord =
    sender && typeof sender === "object" ? (sender as Record<string, unknown>) : null;
  const orchestrationRecord =
    orchestration && typeof orchestration === "object"
      ? (orchestration as Record<string, unknown>)
      : null;
  const senderAgentId =
    typeof senderRecord?.agentId === "string" ? senderRecord.agentId : "";
  const senderAgentName =
    typeof senderRecord?.agentName === "string" ? senderRecord.agentName : "";
  const senderRole =
    typeof senderRecord?.role === "string" ? senderRecord.role : "";
  const orchestrationAction =
    typeof orchestrationRecord?.action === "string"
      ? orchestrationRecord.action
      : "";
  const orchestrationDetail =
    typeof orchestrationRecord?.detail === "string"
      ? orchestrationRecord.detail
      : "";
  const topLevelArtifacts = Array.isArray(rec.artifacts)
    ? rec.artifacts
        .map((artifact) => extractFileArtifact(artifact))
        .filter((artifact): artifact is FileArtifact => Boolean(artifact))
    : undefined;
  const contentArtifacts = collectArtifacts(contentToBlocks(asContentSource(message)));

  return {
    sender: senderRecord
      ? {
          agentId: senderAgentId,
          agentName: senderAgentName,
          role: senderRole,
        }
      : undefined,
    type: type === "orchestration" || type === "text" ? type : undefined,
    orchestration: orchestrationRecord
      ? { action: orchestrationAction, detail: orchestrationDetail }
      : undefined,
    artifacts: mergeArtifacts(topLevelArtifacts, contentArtifacts),
  };
}

export { asContentSource };
