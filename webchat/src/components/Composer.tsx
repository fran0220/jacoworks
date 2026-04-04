import { useRef, useCallback, useMemo, useEffect, useState } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import type { AgentSummary } from "../lib/feed";
import { uploadFile, validateFileSize, buildMessageWithAttachments } from "../lib/upload";
import { formatSize } from "../lib/file-utils";
import MentionPopover, { type MentionOption } from "./MentionPopover";
import { usePretextFont, calcTextHeight } from "../hooks/usePretext";
import type { FileArtifact } from "../types";

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

interface PendingUpload {
  localId: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  vmPath?: string;
  artifact?: FileArtifact;
  error?: string;
}

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

let uploadCounter = 0;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);

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

  const hasUploading = uploads.some((u) => u.status === "uploading");
  const readyUploads = uploads.filter((u) => u.status === "ready" && u.vmPath);

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
    if (!el || hasUploading) return;
    const rawText = el.value.trim();
    if ((!rawText && readyUploads.length === 0) || disabled || streaming) return;

    const finalText = buildMessageWithAttachments(
      rawText,
      readyUploads.map((u) => ({ name: u.name, vmPath: u.vmPath! })),
    );
    if (!finalText) return;

    onSend(finalText);
    el.value = "";
    setMentionRange(null);
    setUploads([]);
    autoResize();
  }, [disabled, streaming, onSend, autoResize, hasUploading, readyUploads]);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const error = validateFileSize(file);
      const localId = `upload-${++uploadCounter}`;
      const pending: PendingUpload = {
        localId,
        name: file.name,
        size: file.size,
        status: error ? "error" : "uploading",
        error: error ?? undefined,
      };

      setUploads((prev) => [...prev, pending]);

      if (!error) {
        uploadFile(file)
          .then((result) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.localId === localId
                  ? { ...u, status: "ready" as const, vmPath: result.vmPath, artifact: result.artifact }
                  : u,
              ),
            );
          })
          .catch((err: Error) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.localId === localId ? { ...u, status: "error" as const, error: err.message } : u,
              ),
            );
          });
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeUpload = useCallback((localId: string) => {
    setUploads((prev) => prev.filter((u) => u.localId !== localId));
  }, []);

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
        {uploads.length > 0 && (
          <div className="composer-uploads">
            {uploads.map((u) => (
              <div
                key={u.localId}
                className={`upload-chip ${u.status === "error" ? "upload-chip-error" : ""}`}
              >
                {u.status === "uploading" && <Loader2 size={14} className="upload-chip-spinner" />}
                <span className="upload-chip-name">{u.name}</span>
                <span className="upload-chip-size">{formatSize(u.size)}</span>
                {u.status === "error" && <span className="upload-chip-error-text">{u.error}</span>}
                <button className="upload-chip-remove" onClick={() => removeUpload(u.localId)} title="移除">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || streaming}
            title="上传附件"
          >
            <Paperclip size={18} />
          </button>
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
            <button className="send-btn" disabled={disabled || hasUploading} onClick={handleSend}>发送</button>
          )}
        </div>
      </div>
    </div>
  );
}
