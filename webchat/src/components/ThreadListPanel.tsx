import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader, Plus, Trash2, X } from "lucide-react";
import {
  buildTeamOptions,
  parseTeamTemplateIdFromSessionKey,
} from "../lib/team-utils";
import { fetchAgentPresets, fetchTeams } from "../lib/teams";
import { usePretextFont, calcTextHeight } from "../hooks/usePretext";

interface ThreadMeta {
  id: string;
  workspaceKey: string;
  title: string;
  updatedAt: number;
}

interface WorkspaceOption {
  sessionKey: string;
  label: string;
  source: "preset" | "profile" | "installed" | "default" | "current";
}

function stripMarkdown(text: string): string {
  return text.replace(/[#*_~`>[\]()!]/g, "").trim();
}

function formatUpdatedAt(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h`;
  return new Date(updatedAt).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function formatWorkspaceLabel(option: WorkspaceOption): string {
  if (option.source === "installed") return `${option.label} · 团队`;
  if (option.source === "preset") return `${option.label} · 预设`;
  if (option.source === "profile") return `${option.label} · Agent`;
  if (option.source === "default") return `${option.label} · 默认`;
  const teamId = parseTeamTemplateIdFromSessionKey(option.label);
  if (teamId) return `${teamId} · 团队实例`;
  return option.label;
}

/* ---- Virtual thread list ---- */

const ITEM_BASE_HEIGHT = 56; // single-line item height (px) — padding + title + meta + gap
const ITEM_GAP = 7; // ~0.45rem gap between items
const BUFFER = 3;
const VIRTUALIZE_THRESHOLD = 20;

function useItemHeights(
  threads: ThreadMeta[],
  font: string,
  lineHeight: number,
  titleWidth: number,
  ready: boolean,
): number[] {
  return useMemo(() => {
    if (!ready || titleWidth <= 0) {
      return threads.map(() => ITEM_BASE_HEIGHT);
    }
    return threads.map((thread) => {
      const title = stripMarkdown(thread.title) || "新线程";
      const { lineCount } = calcTextHeight(title, font, lineHeight, titleWidth);
      if (lineCount <= 1) return ITEM_BASE_HEIGHT;
      // extra lines beyond the first add one lineHeight each
      return ITEM_BASE_HEIGHT + (lineCount - 1) * lineHeight;
    });
  }, [threads, font, lineHeight, titleWidth, ready]);
}

function VirtualThreadList({
  threads,
  activeThreadId,
  onSelect,
  onCreate,
  onDelete,
}: {
  threads: ThreadMeta[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const fontInfo = usePretextFont(titleRef);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const [titleWidth, setTitleWidth] = useState(0);
  const rafId = useRef(0);

  // Measure container & title width
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      setViewHeight(el.clientHeight);
      // title width ≈ list width - item padding (0.85rem×2 ≈ 27px) - delete btn (34px + gap 7px)
      setTitleWidth(Math.max(0, el.clientWidth - 27 * 2 - 34 - 7));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const itemHeights = useItemHeights(
    threads,
    fontInfo.font,
    fontInfo.lineHeight,
    titleWidth,
    fontInfo.ready,
  );

  // Prefix sums for cumulative offsets (including gap)
  const offsets = useMemo(() => {
    const arr = new Float64Array(threads.length + 1);
    for (let i = 0; i < threads.length; i++) {
      arr[i + 1] =
        arr[i] + itemHeights[i] + (i < threads.length - 1 ? ITEM_GAP : 0);
    }
    return arr;
  }, [itemHeights, threads.length]);

  const totalHeight = offsets[threads.length] ?? 0;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const st = (e.target as HTMLDivElement).scrollTop;
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => setScrollTop(st));
  }, []);

  // Scroll active thread into view
  useEffect(() => {
    if (!activeThreadId || !listRef.current) return;
    const idx = threads.findIndex((t) => t.id === activeThreadId);
    if (idx < 0) return;
    const top = offsets[idx];
    const bottom = offsets[idx + 1];
    const el = listRef.current;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight;
    }
  }, [activeThreadId, threads, offsets]);

  // For small lists, render everything directly
  const skipVirtual = threads.length < VIRTUALIZE_THRESHOLD;

  // Compute visible range
  let startIdx = 0;
  let endIdx = threads.length;

  if (!skipVirtual && threads.length > 0) {
    // Binary search for start
    let lo = 0;
    let hi = threads.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    startIdx = Math.max(0, lo - BUFFER);

    // Binary search for end
    const bottomEdge = scrollTop + viewHeight;
    lo = startIdx;
    hi = threads.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] < bottomEdge) lo = mid + 1;
      else hi = mid;
    }
    endIdx = Math.min(threads.length, lo + BUFFER);
  }

  const visibleThreads = threads.slice(startIdx, endIdx);
  const topSpacer = offsets[startIdx];
  const bottomSpacer = totalHeight - (offsets[endIdx] ?? totalHeight);

  return (
    <div className="thread-panel-list-wrap">
      <div className="thread-panel-list-head">
        <span>最近线程</span>
        <span>{threads.length}</span>
      </div>
      {/* Hidden ref for font measurement */}
      <div
        ref={titleRef}
        className="thread-panel-item-title"
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      />
      <div ref={listRef} className="thread-panel-list" onScroll={onScroll}>
        {threads.length === 0 ? (
          <div className="thread-panel-empty">
            <span>当前工作空间还没有线程。</span>
            <button
              className="thread-panel-empty-action"
              onClick={() => void onCreate()}
            >
              创建第一条线程
            </button>
          </div>
        ) : skipVirtual ? (
          threads.map((thread) => (
            <article
              key={thread.id}
              className={`thread-panel-item${thread.id === activeThreadId ? " active" : ""}`}
            >
              <button
                className="thread-panel-item-main"
                onClick={() => onSelect(thread.id)}
              >
                <span className="thread-panel-item-title">
                  {stripMarkdown(thread.title) || "新线程"}
                </span>
                <span className="thread-panel-item-meta">
                  {formatUpdatedAt(thread.updatedAt)}
                </span>
              </button>
              <button
                className="thread-panel-item-delete"
                onClick={() => void onDelete(thread.id)}
                title="删除线程"
              >
                <Trash2 size={13} />
              </button>
            </article>
          ))
        ) : (
          <>
            {topSpacer > 0 && (
              <div style={{ height: topSpacer, flexShrink: 0 }} />
            )}
            {visibleThreads.map((thread) => (
              <article
                key={thread.id}
                className={`thread-panel-item${thread.id === activeThreadId ? " active" : ""}`}
              >
                <button
                  className="thread-panel-item-main"
                  onClick={() => onSelect(thread.id)}
                >
                  <span className="thread-panel-item-title">
                    {stripMarkdown(thread.title) || "新线程"}
                  </span>
                  <span className="thread-panel-item-meta">
                    {formatUpdatedAt(thread.updatedAt)}
                  </span>
                </button>
                <button
                  className="thread-panel-item-delete"
                  onClick={() => void onDelete(thread.id)}
                  title="删除线程"
                >
                  <Trash2 size={13} />
                </button>
              </article>
            ))}
            {bottomSpacer > 0 && (
              <div style={{ height: bottomSpacer, flexShrink: 0 }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ThreadListPanel({
  workspaceKey,
  threads,
  activeThreadId,
  onSelect,
  onCreate,
  onDelete,
  onWorkspaceChange,
  open,
  onClose,
}: {
  workspaceKey: string;
  threads: ThreadMeta[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onWorkspaceChange: (key: string) => void;
  open?: boolean;
  onClose?: () => void;
}) {
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [teams, presets] = await Promise.all([
          fetchTeams(),
          fetchAgentPresets(),
        ]);
        if (cancelled) return;
        const mapped = buildTeamOptions(teams, presets).map((item) => ({
          ...item,
        }));
        setOptions(mapped);
      } catch {
        if (!cancelled) {
          setError("协作空间加载失败");
          setOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const workspaceOptions = useMemo(() => {
    const current = options.some((option) => option.sessionKey === workspaceKey)
      ? options
      : [
          {
            sessionKey: workspaceKey,
            label: workspaceKey,
            source: "current" as const,
          },
          ...options,
        ];

    return current;
  }, [options, workspaceKey]);

  return (
    <aside className={`workbench-threads${open ? " open" : ""}`}>
      <div className="thread-panel-head">
        <div>
          <p className="thread-panel-eyebrow">Workspace</p>
          <strong>线程</strong>
        </div>
        <div className="thread-panel-head-actions">
          {open && onClose && (
            <button
              className="thread-panel-action"
              onClick={onClose}
              title="关闭线程面板"
            >
              <X size={15} />
            </button>
          )}
          <button
            className="thread-panel-action thread-panel-action--accent"
            onClick={() => void onCreate()}
            title="新建线程"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="thread-panel-workspace">
        <label
          className="thread-panel-label"
          htmlFor="workbench-workspace-select"
        >
          当前协作空间
        </label>
        <div className="thread-panel-select-wrap">
          <select
            id="workbench-workspace-select"
            className="thread-panel-select"
            value={workspaceKey}
            disabled={loading}
            onChange={(event) => onWorkspaceChange(event.target.value)}
          >
            {workspaceOptions.map((option) => (
              <option key={option.sessionKey} value={option.sessionKey}>
                {formatWorkspaceLabel(option)}
              </option>
            ))}
          </select>
          {loading && (
            <Loader
              size={14}
              className="spin-icon thread-panel-select-loader"
            />
          )}
        </div>
        {error && <p className="thread-panel-error">{error}</p>}
      </div>

      <VirtualThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={onSelect}
        onCreate={onCreate}
        onDelete={onDelete}
      />
    </aside>
  );
}
