import { ChevronUp, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { CronResultItem } from "../hooks/use-cron-results";

const FREQ_PRESETS = [
  { label: "每30分钟", kind: "every", expr: "30m" },
  { label: "每小时", kind: "every", expr: "1h" },
  { label: "每天", kind: "every", expr: "24h" },
  { label: "自定义", kind: "", expr: "" },
] as const;

const CUSTOM_KINDS = [
  { value: "every", label: "间隔", placeholder: "如 5m、2h" },
  { value: "cron", label: "Cron", placeholder: "如 0 9 * * 1-5" },
  { value: "at", label: "定时", placeholder: "如 +30m、2026-03-07T10:00" },
] as const;

function CronJobForm({ onSubmit, onClose }: { onSubmit: (prompt: string) => void; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customKind, setCustomKind] = useState("every");
  const [customExpr, setCustomExpr] = useState("");

  const isCustom = selectedPreset === FREQ_PRESETS.length - 1;
  const hasSchedule = isCustom ? customExpr.trim() !== "" : true;
  const canSubmit = prompt.trim() !== "" && hasSchedule;

  const handleSubmit = () => {
    const preset = FREQ_PRESETS[selectedPreset];
    const kind = isCustom ? customKind : preset.kind;
    const expr = isCustom ? customExpr.trim() : preset.expr;

    const composed = [
      `请使用 cron_manage 工具创建一个定时任务，参数如下：`,
      `- action: create`,
      `- scheduleKind: ${kind}`,
      `- schedule: ${expr}`,
      `- prompt: ${prompt.trim()}`,
      `- name: 根据任务内容自动生成一个简短名称`,
      `- sessionTarget: isolated`,
      kind === "at" ? `- deleteAfterRun: true` : null,
      `\n请直接调用工具，不需要确认。`,
    ].filter(Boolean).join("\n");

    onSubmit(composed);
  };

  const kindInfo = CUSTOM_KINDS.find((k) => k.value === customKind);

  return (
    <div className="tp-form-wrapper">
      <div className="tp-form">
        <div className="tp-form-row">
          <label className="tp-form-label">任务内容</label>
          <textarea
            className="tp-form-input tp-form-textarea"
            placeholder="让 AI 做什么…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
        </div>

        <div className="tp-form-row">
          <label className="tp-form-label">执行频率</label>
          <div className="tp-freq-grid">
            {FREQ_PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                className={`tp-freq-btn${selectedPreset === i ? " active" : ""}`}
                onClick={() => setSelectedPreset(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {isCustom && (
          <div className="tp-form-row">
            <div className="tp-custom-row">
              <select
                className="tp-form-input tp-form-select tp-custom-kind"
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value)}
              >
                {CUSTOM_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <input
                className="tp-form-input tp-custom-expr"
                placeholder={kindInfo?.placeholder}
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="tp-form-actions">
          <button type="button" className="tp-form-btn tp-form-btn--cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="tp-form-btn tp-form-btn--submit"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            创建并执行
          </button>
        </div>
      </div>
    </div>
  );
}

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
  onCreateCronTask,
  onClose,
}: {
  results: CronResultItem[];
  onClearResults: () => void;
  onCreateCronTask: (prompt: string) => void;
  onClose: () => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

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
        <button type="button" className="tp-pill tp-pill--cron" onClick={() => setShowForm((v) => !v)}>
          <Plus size={13} />
          新建定时任务
        </button>
      </div>

      {/* Cron create form */}
      {showForm && (
        <CronJobForm
          onSubmit={(prompt) => {
            setShowForm(false);
            onCreateCronTask(prompt);
          }}
          onClose={() => setShowForm(false)}
        />
      )}

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
