import { useRef, useCallback, useMemo, useEffect, useState } from "react";
import type { AgentSummary } from "../lib/feed";
import MentionPopover, { type MentionOption } from "./MentionPopover";
import { usePretextFont, calcTextHeight } from "../hooks/usePretext";

const ROLE_LABELS: Record<string, string> = {
  planner: "规划师",
  executor: "执行者",
  reviewer: "审查员",
  patrol: "巡查员",
  team: "全体",
};

const TEAM_MENTION: MentionOption = {
  id: "team",
  mention: "@team",
  label: "全体协作",
  role: "team",
  roleLabel: "广播",
};

function buildMentionOptions(agents: AgentSummary[]): MentionOption[] {
  return agents.map((agent) => ({
    id: agent.id,
    mention: `@${agent.role}`,
    label: agent.name,
    role: agent.role,
    roleLabel: ROLE_LABELS[agent.role] ?? agent.role,
  }));
}

function findMentionQuery(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");

  if (atIndex === -1) return null;
  if (atIndex > 0) {
    const prevChar = beforeCursor[atIndex - 1];
    if (!/[\s([{]/.test(prevChar)) return null;
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (/\s/.test(query)) return null;

  let end = cursor;
  while (end < value.length && !/\s/.test(value[end])) {
    end += 1;
  }

  return { start: atIndex, end, query };
}

export default function Composer({
  disabled,
  streaming,
  onSend,
  onAbort,
  agents = [],
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  agents?: AgentSummary[];
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const fontInfo = usePretextFont(textareaRef);

  const mentionOptions = useMemo(() => [TEAM_MENTION, ...buildMentionOptions(agents)], [agents]);

  const filteredOptions = useMemo(() => {
    if (!mentionRange) return [];
    const normalizedQuery = mentionRange.query.trim().toLowerCase();
    if (!normalizedQuery) return mentionOptions;

    return mentionOptions.filter((option) => {
      const haystacks = [option.mention, option.label, option.role, option.roleLabel];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [mentionOptions, mentionRange]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (!fontInfo.ready) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
      return;
    }

    const cs = getComputedStyle(el);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const innerWidth = el.clientWidth - padX;
    const { height: textH } = calcTextHeight(el.value, fontInfo.font, fontInfo.lineHeight, innerWidth, "pre-wrap");
    const total = textH > 0 ? textH + padY : fontInfo.lineHeight + padY;
    el.style.height = `${Math.min(total, 140)}px`;
  }, [fontInfo]);

  const syncMentionState = useCallback(() => {
    const el = textareaRef.current;
    if (!el || isComposingRef.current) return;
    setMentionRange(findMentionQuery(el.value, el.selectionStart ?? el.value.length));
  }, []);

  const handleSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    el.value = "";
    setMentionRange(null);
    autoResize();
  }, [disabled, streaming, onSend, autoResize]);

  const handleMentionSelect = useCallback(
    (option: MentionOption) => {
      const el = textareaRef.current;
      if (!el || !mentionRange) return;

      const nextMention = `${option.mention} `;
      el.value = `${el.value.slice(0, mentionRange.start)}${nextMention}${el.value.slice(mentionRange.end)}`;

      const nextCursor = mentionRange.start + nextMention.length;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      setMentionRange(null);
      setActiveIndex(0);
      autoResize();
    },
    [mentionRange, autoResize],
  );

  useEffect(() => {
    if (filteredOptions.length === 0) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((prev) => Math.min(prev, filteredOptions.length - 1));
  }, [filteredOptions]);

  useEffect(() => {
    if (!mentionRange) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (composerRef.current?.contains(event.target as Node)) return;
      setMentionRange(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [mentionRange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionRange && !isComposingRef.current && !e.nativeEvent.isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (filteredOptions.length > 0) {
            setActiveIndex((prev) => (prev + 1) % filteredOptions.length);
          }
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (filteredOptions.length > 0) {
            setActiveIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
          }
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setMentionRange(null);
          return;
        }

        if (e.key === "Enter" && !e.shiftKey && filteredOptions.length > 0) {
          e.preventDefault();
          handleMentionSelect(filteredOptions[activeIndex] ?? filteredOptions[0]);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!streaming) handleSend();
      }
    },
    [activeIndex, filteredOptions, handleMentionSelect, handleSend, mentionRange, streaming],
  );

  return (
    <div className="composer">
      <div className="composer-inner" ref={composerRef}>
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            placeholder="输入消息... (输入 @ 可提及角色，Shift+Enter 换行)"
            rows={1}
            disabled={disabled}
            onInput={() => {
              autoResize();
              syncMentionState();
            }}
            onSelect={syncMentionState}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
              setMentionRange(null);
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              syncMentionState();
            }}
          />
          <MentionPopover
            open={mentionRange !== null}
            options={filteredOptions}
            selectedIndex={activeIndex}
            onSelect={handleMentionSelect}
          />
        </div>
        {streaming ? (
          <button className="abort-btn" onClick={onAbort}>停止</button>
        ) : (
          <button className="send-btn" disabled={disabled} onClick={handleSend}>发送</button>
        )}
      </div>
    </div>
  );
}
