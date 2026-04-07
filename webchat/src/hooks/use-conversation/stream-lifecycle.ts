import type { MutableRefObject } from "react";
import { generateTitle } from "../../lib/sessions";
import { posthog } from "../../lib/posthog";
import {
  contentToBlocks,
  extractText,
  streamBlocksToContent,
  toContentItems,
} from "../../lib/message-extract";
import type {
  ChatMessage,
  ChatSender,
  StreamBlock,
} from "../../types";
import type { UseWorkspaceResult } from "../useWorkspace";
import {
  asContentSource,
  collectArtifacts,
  extractFinalMessageMeta,
  mergeArtifacts,
} from "./content";

interface StreamFinalizeDeps {
  streamingRef: MutableRefObject<boolean>;
  clearStreamTimeout: () => void;
  blocksRef: MutableRefObject<StreamBlock[]>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  activeThreadRef: MutableRefObject<string | null>;
  workspaceRef: MutableRefObject<UseWorkspaceResult>;
  clearRenderTimer: () => void;
  setBlocks: (blocks: StreamBlock[]) => void;
  setStreaming: (streaming: boolean) => void;
  setMessages: (messages: ChatMessage[]) => void;
  streamTextRef: MutableRefObject<string>;
  contentStartedRef: MutableRefObject<boolean>;
  currentSenderRef: MutableRefObject<ChatSender | undefined>;
}

export function finishStreamLifecycle(
  finalMessage: unknown,
  {
    streamingRef,
    clearStreamTimeout,
    blocksRef,
    messagesRef,
    activeThreadRef,
    workspaceRef,
    clearRenderTimer,
    setBlocks,
    setStreaming,
    setMessages,
    streamTextRef,
    contentStartedRef,
    currentSenderRef,
  }: StreamFinalizeDeps,
): void {
  if (!streamingRef.current) {
    currentSenderRef.current = undefined;
    return;
  }
  streamingRef.current = false;
  clearStreamTimeout();

  const streamedBlocks = [...blocksRef.current];
  const fallbackText = streamedBlocks
    .filter((block) => block.type === "text")
    .map((block) => block.content)
    .join("");

  const finalContent = toContentItems(asContentSource(finalMessage));
  const content =
    finalContent.length > 0
      ? finalContent
      : streamBlocksToContent(streamedBlocks);
  const finalBlocks =
    finalContent.length > 0 ? contentToBlocks(finalContent) : streamedBlocks;
  const hasAnyOutput =
    content.length > 0 ||
    finalBlocks.length > 0 ||
    fallbackText.trim().length > 0;

  if (hasAnyOutput) {
    const finalMeta = extractFinalMessageMeta(finalMessage);
    const derivedArtifacts = collectArtifacts(finalBlocks);
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: content.length > 0 ? content : fallbackText,
      blocks: finalBlocks.length > 0 ? finalBlocks : undefined,
      timestamp: Date.now(),
      ...finalMeta,
      sender: finalMeta.sender || currentSenderRef.current || undefined,
      artifacts: mergeArtifacts(finalMeta.artifacts, derivedArtifacts),
    };
    const updated = [...messagesRef.current, assistantMsg];
    const assistantText = extractText(assistantMsg.content) || fallbackText;

    setMessages(updated);
    posthog.capture("chat_response_received", { length: assistantText.length });

    const threadId = activeThreadRef.current;
    if (threadId) {
      void workspaceRef.current.saveThreadMessages(threadId, updated);
      if (
        assistantText &&
        updated.filter((message) => message.role === "assistant").length === 1
      ) {
        void workspaceRef.current.renameThread(
          threadId,
          generateTitle(assistantText),
        );
      }
    }
  }

  clearRenderTimer();
  streamTextRef.current = "";
  contentStartedRef.current = false;
  currentSenderRef.current = undefined;
  setBlocks([]);
  setStreaming(false);
}
