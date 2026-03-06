import { AlertCircle, ChevronDown, ChevronUp, Cloud, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { CronResultItem } from "../hooks/use-cron-results";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);

  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays === 2) return `前天 ${time}`;
  return `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${time}`;
}

export default function TaskPanel({
  results,
  onClearResults,
  onNewCoworkSession,
  onClose,
}: {
  results: CronResultItem[];
  onClearResults: () => void;
  onNewCoworkSession: () => void;
  onClose: () => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  };

  return (
    <div className="task-panel">
      {/* Header */}
      <div className="tp-header">
        <h3 className="tp-title">任务面板</h3>
        <button type="button" className="tp-close" onClick={onClose} title="关闭">
          <X size={14} />
        </button>
      </div>

      {/* Action pills */}
      <div className="tp-actions">
        <button type="button" className="tp-pill tp-pill--cloud" onClick={onNewCoworkSession}>
          <Cloud size={13} />
          新建云端对话
        </button>
        <button type="button" className="tp-pill tp-pill--cron" onClick={() => {}}>
          <Plus size={13} />
          新建定时任务
        </button>
      </div>

      {/* Timeline */}
      <div className="tp-timeline-scroll">
        {results.length === 0 ? (
          <div className="tp-empty">
            <div className="tp-empty-icon">⏰</div>
            <div className="tp-empty-text">暂无定时任务执行记录</div>
          </div>
        ) : (
          <div className="tp-timeline">
            {results.map((item, index) => {
              const isError = item.status === "error";
              const isExpanded = expandedIndex === index;

              return (
                <div
                  key={`${item.jobId}-${item.timestamp}-${index}`}
                  className={`tp-node${isError ? " error" : ""}${isExpanded ? " expanded" : ""}`}
                >
                  {/* Time label */}
                  <div className="tp-node-time">
                    {formatRelativeDate(item.timestamp)}
                  </div>

                  {/* Dot on timeline */}
                  <div className={`tp-node-dot${isError ? " error" : ""}`} />

                  {/* Card */}
                  <div
                    className={`tp-card${isError ? " error" : ""}${isExpanded ? " expanded" : ""}`}
                    onClick={() => toggle(index)}
                  >
                    {/* Card header - always visible */}
                    <div className="tp-card-header">
                      <span className="tp-card-name">
                        {item.jobName || item.jobId}
                      </span>
                      <span className={`tp-card-meta${isError ? " error" : ""}`}>
                        {isError ? "超时" : formatDuration(item.durationMs)}
                      </span>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="tp-card-detail">
                        {item.resultPreview && (
                          <div className="tp-card-preview">{item.resultPreview}</div>
                        )}
                        {isError && item.error && (
                          <div className="tp-card-error">错误: {item.error}</div>
                        )}

                        {/* Actions */}
                        <div className="tp-card-actions">
                          <button type="button" className="tp-action-btn rerun">
                            <RefreshCw size={11} />
                            重新运行
                          </button>
                          <button type="button" className="tp-action-btn delete">
                            <Trash2 size={11} />
                            删除任务
                          </button>
                        </div>

                        {/* Collapse hint */}
                        <button
                          type="button"
                          className="tp-collapse-hint"
                          onClick={(e) => { e.stopPropagation(); setExpandedIndex(null); }}
                        >
                          <ChevronUp size={12} />
                          收起
                        </button>
                      </div>
                    )}

                    {/* Expand hint on collapsed error */}
                    {!isExpanded && isError && item.error && (
                      <div className="tp-card-error-hint">{item.error}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {results.length > 0 && (
          <button type="button" className="tp-clear-all" onClick={onClearResults}>
            清除全部记录
          </button>
        )}
      </div>
    </div>
  );
}
