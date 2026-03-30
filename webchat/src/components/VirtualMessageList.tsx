import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { AgentSummary } from "../lib/feed";
import { DEFAULT_OPENCLAW_SESSION_KEY } from "../lib/config";
import { parseAgentIdFromSessionKey } from "../lib/team-utils";
import type { ChatMessage, ChatSender, FileArtifact, StreamBlock } from "../types";
import { contentToBlocks, extractText } from "../lib/message-extract";
import { usePretextFont, useShrinkwrap, calcTextHeight } from "../hooks/usePretext";
import StreamingCursor from "./StreamingCursor";
import ThinkingBlock from "./ThinkingBlock";
import ToolStatus from "./ToolStatus";
import Markdown from "./Markdown";
import FileCard from "./FileCard";
import OrchestrationRow from "./OrchestrationRow";

/* ---- Constants ---- */

const BUFFER = 5;
const ORCHESTRATION_HEIGHT = 40;
const ASSISTANT_HEADER_HEIGHT = 28;
const BUBBLE_ROW_PAD = 12; // 0.375rem * 2
const USER_BUBBLE_PAD_V = 20; // 0.625rem * 2
const USER_BUBBLE_H_PAD = 32; // 1rem * 2
const USER_BUBBLE_LINE_HEIGHT = 22.4; // 14px * 1.6
const TEXT_BLOCK_HEIGHT_PER_LINE = 24;
const THINKING_BLOCK_HEIGHT = 48;
const TOOL_BLOCK_HEIGHT = 44;
const FILE_CARD_HEIGHT = 112;
const IMAGE_FILE_CARD_HEIGHT = 252;
const DEFAULT_MSG_HEIGHT = 80;
const USER_MAX_WIDTH_RATIO = 0.75;

/* ---- Helpers (shared with ChatView) ---- */

const ROLE_LABELS: Record<string, string> = {
  default: "默认助手",
  leader: "协作队长",
  planner: "规划师",
  executor: "执行者",
  reviewer: "审查员",
  patrol: "巡查员",
};

function resolveSender(
  message: ChatMessage,
  activeWorkspaceKey: string,
  agentSummaries: AgentSummary[],
): ChatSender | undefined {
  if (message.sender) return message.sender;
  if (message.role !== "assistant") return undefined;

  const agentId = parseAgentIdFromSessionKey(activeWorkspaceKey);
  if (agentId) {
    const summary = agentSummaries.find((a) => a.id === agentId);
    if (summary) {
      return { agentId: summary.id, agentName: summary.name, role: summary.role };
    }
    return {
      agentId,
      agentName: agentId === "default" ? "默认助手" : agentId,
      role: agentId === "default" ? "default" : "leader",
    };
  }

  if (activeWorkspaceKey === DEFAULT_OPENCLAW_SESSION_KEY) {
    return { agentId: "default", agentName: "默认助手", role: "default" };
  }
  return undefined;
}

function AssistantHeader({ sender }: { sender?: ChatSender }) {
  if (!sender) return null;

  if (sender.role === "default" || (!sender.role && sender.agentId === "default")) {
    return (
      <div className="msg-agent-header">
        <span className="msg-agent-name">亦城</span>
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[sender.role] ?? sender.role;
  const roleClass = sender.role ? ` msg-agent-role-badge--${sender.role}` : "";

  return (
    <div className="msg-agent-header">
      <span className={`msg-agent-role-badge${roleClass}`}>{roleLabel}</span>
      <span className="msg-agent-name">{sender.agentName}</span>
    </div>
  );
}

function renderBlock(
  block: StreamBlock,
  idx: number,
  all: StreamBlock[],
  streaming: boolean,
  onPreview: (artifact: FileArtifact) => void,
) {
  if (block.type === "text") {
    return (
      <div className="bubble-row" key={`block-text-${idx}`}>
        <div className="assistant-bubble">
          <Markdown content={block.content} />
          {streaming && idx === all.length - 1 && <StreamingCursor />}
        </div>
      </div>
    );
  }

  if (block.type === "thinking") {
    return <ThinkingBlock key={`block-think-${idx}`} content={block.content} streaming={streaming} />;
  }

  if (block.type === "tool") {
    return (
      <div className="tool-block-stack" key={`block-tool-${idx}`}>
        <ToolStatus toolName={block.name} status={block.status} args={block.args} output={block.output} />
        {block.artifact && <FileCard artifact={block.artifact} onPreview={onPreview} />}
      </div>
    );
  }

  return null;
}

/* ---- Height estimation ---- */

function estimateUserHeight(
  content: string,
  font: string,
  containerWidth: number,
): number {
  const maxWidth = containerWidth * USER_MAX_WIDTH_RATIO - USER_BUBBLE_H_PAD;
  if (maxWidth <= 0) return 60;
  if (font) {
    const { height } = calcTextHeight(content, font, USER_BUBBLE_LINE_HEIGHT, maxWidth, "pre-wrap");
    return height + USER_BUBBLE_PAD_V + BUBBLE_ROW_PAD;
  }
  const lines = Math.max(1, Math.ceil((content.length * 7.7) / maxWidth));
  return lines * USER_BUBBLE_LINE_HEIGHT + USER_BUBBLE_PAD_V + BUBBLE_ROW_PAD;
}

function estimateAssistantHeight(msg: ChatMessage): number {
  const blocks = msg.blocks?.length ? msg.blocks : contentToBlocks(msg.content);
  if (blocks.length === 0) {
    const text = extractText(msg.content);
    if (!text) return 0;
    const lines = Math.max(1, text.split("\n").length);
    return ASSISTANT_HEADER_HEIGHT + lines * TEXT_BLOCK_HEIGHT_PER_LINE + BUBBLE_ROW_PAD;
  }

  let h = ASSISTANT_HEADER_HEIGHT;
  for (const block of blocks) {
    if (block.type === "text") {
      const lines = Math.max(1, block.content.split("\n").length);
      h += lines * TEXT_BLOCK_HEIGHT_PER_LINE + BUBBLE_ROW_PAD;
    } else if (block.type === "thinking") {
      h += THINKING_BLOCK_HEIGHT;
    } else if (block.type === "tool") {
      h += TOOL_BLOCK_HEIGHT;
      if (block.artifact) {
        h += block.artifact.category === "image" ? IMAGE_FILE_CARD_HEIGHT : FILE_CARD_HEIGHT;
      }
    }
  }
  return h;
}

function estimateHeight(
  msg: ChatMessage,
  font: string,
  containerWidth: number,
): number {
  if (msg.type === "orchestration") return ORCHESTRATION_HEIGHT;
  if (msg.role === "user") return estimateUserHeight(extractText(msg.content), font, containerWidth);
  if (msg.role === "assistant") return estimateAssistantHeight(msg);
  return DEFAULT_MSG_HEIGHT;
}

/* ---- UserMessage with shrinkwrap ---- */

function UserMessage({ content, fontInfo }: { content: string; fontInfo: ReturnType<typeof usePretextFont> }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [maxBubbleWidth, setMaxBubbleWidth] = useState(0);

  useEffect(() => {
    const el = rowRef.current;
    if (el && el.offsetWidth > 0) {
      setMaxBubbleWidth(Math.floor(el.offsetWidth * USER_MAX_WIDTH_RATIO));
    }
  }, []);

  const textWidth = useShrinkwrap(content, maxBubbleWidth - USER_BUBBLE_H_PAD, fontInfo);
  const bubbleStyle = textWidth > 0 ? { width: textWidth + USER_BUBBLE_H_PAD } : undefined;

  return (
    <div className="bubble-row user" ref={rowRef}>
      <div className="user-bubble" style={bubbleStyle}>{content}</div>
    </div>
  );
}

/* ---- VirtualMessageList ---- */

interface VirtualMessageListProps {
  messages: ChatMessage[];
  activeWorkspaceKey: string;
  agentSummaries: AgentSummary[];
  onPreview: (artifact: FileArtifact) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export default function VirtualMessageList({
  messages,
  activeWorkspaceKey,
  agentSummaries,
  onPreview,
  scrollRef,
}: VirtualMessageListProps) {
  const fontInfo = usePretextFont();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const heightsRef = useRef<number[]>([]);
  const measuredRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<ResizeObserver | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rafRef = useRef(0);
  const [, forceUpdate] = useState(0);

  // Sync heights array with messages
  const heights = heightsRef.current;
  const containerWidth = scrollRef.current?.clientWidth ?? 700;
  if (heights.length !== messages.length) {
    const prev = heights.length;
    heights.length = messages.length;
    for (let i = prev; i < messages.length; i++) {
      heights[i] = estimateHeight(messages[i], fontInfo.font, containerWidth);
    }
    if (messages.length < prev) {
      measuredRef.current = new Set([...measuredRef.current].filter((idx) => idx < messages.length));
    }
  }

  // Compute offsets and total height
  const { offsets, totalHeight } = useMemo(() => {
    const offs = new Float64Array(messages.length);
    let acc = 0;
    for (let i = 0; i < messages.length; i++) {
      offs[i] = acc;
      acc += heights[i] || 0;
    }
    return { offsets: offs, totalHeight: acc };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, heights, scrollTop, forceUpdate]);

  // Binary search for visible range
  const startIndex = useMemo(() => {
    let lo = 0;
    let hi = messages.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] + (heights[mid] || 0) < scrollTop) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(0, lo - BUFFER);
  }, [offsets, heights, scrollTop, messages.length]);

  const endIndex = useMemo(() => {
    const bottom = scrollTop + viewportHeight;
    let lo = startIndex;
    let hi = messages.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] < bottom) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.min(messages.length - 1, lo + BUFFER);
  }, [offsets, startIndex, scrollTop, viewportHeight, messages.length]);

  // rAF-throttled scroll handler
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (el) {
        setScrollTop(el.scrollTop);
        setViewportHeight(el.clientHeight);
      }
    });
  }, [scrollRef]);

  // Attach scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, onScroll]);

  // ResizeObserver: correct estimated heights with real measurements
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const idx = Number(el.dataset.vIdx);
        if (Number.isNaN(idx) || idx >= heights.length) continue;
        const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
        if (Math.abs(h - heights[idx]) > 1) {
          heights[idx] = h;
          measuredRef.current.add(idx);
          changed = true;
        }
      }
      if (changed) forceUpdate((n) => n + 1);
    });
    observerRef.current = obs;
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref callback: observe/unobserve items
  const setItemRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    const obs = observerRef.current;
    const prev = itemRefs.current.get(idx);
    if (prev && prev !== el && obs) obs.unobserve(prev);
    if (el) {
      itemRefs.current.set(idx, el);
      if (obs) obs.observe(el);
    } else {
      itemRefs.current.delete(idx);
    }
  }, []);

  // Render visible items
  const visibleItems: React.ReactNode[] = [];
  for (let i = startIndex; i <= endIndex && i < messages.length; i++) {
    const msg = messages[i];
    visibleItems.push(
      <div
        key={i}
        data-v-idx={i}
        ref={(el) => setItemRef(i, el)}
        style={{
          position: "absolute",
          top: offsets[i],
          left: 0,
          right: 0,
        }}
      >
        <MessageItem
          msg={msg}
          activeWorkspaceKey={activeWorkspaceKey}
          agentSummaries={agentSummaries}
          fontInfo={fontInfo}
          onPreview={onPreview}
        />
      </div>,
    );
  }

  return (
    <div style={{ position: "relative", height: totalHeight, minHeight: "100%" }}>
      {visibleItems}
    </div>
  );
}

/* ---- Individual message rendering ---- */

function MessageItem({
  msg,
  activeWorkspaceKey,
  agentSummaries,
  fontInfo,
  onPreview,
}: {
  msg: ChatMessage;
  activeWorkspaceKey: string;
  agentSummaries: AgentSummary[];
  fontInfo: ReturnType<typeof usePretextFont>;
  onPreview: (artifact: FileArtifact) => void;
}) {
  const sender = resolveSender(msg, activeWorkspaceKey, agentSummaries);

  if (msg.type === "orchestration") {
    return (
      <OrchestrationRow
        action={msg.orchestration?.action}
        detail={msg.orchestration?.detail || extractText(msg.content)}
      />
    );
  }

  if (msg.role === "user") {
    return <UserMessage content={extractText(msg.content)} fontInfo={fontInfo} />;
  }

  if (msg.role === "assistant") {
    const msgBlocks = msg.blocks?.length ? msg.blocks : contentToBlocks(msg.content);
    if (msgBlocks.length > 0) {
      return (
        <div className="assistant-message-group">
          <AssistantHeader sender={sender} />
          {msgBlocks.map((block, idx) => renderBlock(block, idx, msgBlocks, false, onPreview))}
        </div>
      );
    }

    const content = extractText(msg.content);
    if (!content) return null;
    return (
      <div className="assistant-message-group">
        <AssistantHeader sender={sender} />
        <div className="bubble-row">
          <div className="assistant-bubble">
            <Markdown content={content} />
          </div>
        </div>
      </div>
    );
  }

  return null;
}
