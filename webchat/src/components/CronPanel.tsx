import { useState, useEffect, useCallback } from "react";
import { Clock, Plus, Trash2, ChevronDown, ChevronUp, Loader, AlertTriangle } from "lucide-react";
import { listCronJobs, createCronJob, deleteCronJob, type CronJob } from "../lib/cron";

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

function formatSchedule(kind: string, expr: string): string {
  if (kind === "every") return `每 ${expr}`;
  if (kind === "cron") return `Cron: ${expr}`;
  if (kind === "at") return `定时: ${expr}`;
  return expr;
}

function formatTime(value: string | null): string {
  if (!value) return "从未执行";
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [prompt, setPrompt] = useState("");
  const [jobName, setJobName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customKind, setCustomKind] = useState("every");
  const [customExpr, setCustomExpr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const list = await listCronJobs();
      setJobs(list);
      setError(null);
    } catch {
      setError("获取任务列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const isCustom = selectedPreset === FREQ_PRESETS.length - 1;
  const hasSchedule = isCustom ? customExpr.trim() !== "" : true;
  const canSubmit = prompt.trim() !== "" && hasSchedule && !submitting;

  const handleCreate = async () => {
    const preset = FREQ_PRESETS[selectedPreset];
    const kind = isCustom ? customKind : preset.kind;
    const expr = isCustom ? customExpr.trim() : preset.expr;

    setSubmitting(true);
    try {
      const job = await createCronJob({
        schedule_kind: kind,
        schedule_expr: expr,
        prompt: prompt.trim(),
        name: jobName.trim() || undefined,
        delete_after_run: kind === "at",
      });
      setJobs((prev) => [job, ...prev]);
      setShowForm(false);
      setPrompt("");
      setJobName("");
      setSelectedPreset(0);
      setCustomExpr("");
    } catch {
      setError("创建任务失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCronJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch {
      setError("删除任务失败");
    }
  };

  const kindInfo = CUSTOM_KINDS.find((k) => k.value === customKind);

  if (loading) {
    return (
      <div className="panel-container">
        <div className="panel-loading">
          <Loader size={20} className="spin-icon" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-container">
      <div className="panel-header">
        <Clock size={16} />
        <h3>定时任务</h3>
        <button
          className="panel-add-btn"
          onClick={() => setShowForm(!showForm)}
          title={showForm ? "取消" : "新建"}
        >
          <Plus size={14} className={showForm ? "icon-rotated" : ""} />
        </button>
      </div>

      {showForm && (
        <div className="cron-form">
          <input
            className="cron-form-input"
            placeholder="任务名称 (可选)"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
          />
          <textarea
            className="cron-form-input cron-form-textarea"
            placeholder="让 AI 做什么..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
          <div className="cron-freq-grid">
            {FREQ_PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                className={`cron-freq-btn${selectedPreset === i ? " active" : ""}`}
                onClick={() => setSelectedPreset(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {isCustom && (
            <div className="cron-custom-row">
              <select
                className="cron-form-input cron-custom-kind"
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value)}
              >
                {CUSTOM_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <input
                className="cron-form-input cron-custom-expr"
                placeholder={kindInfo?.placeholder}
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
              />
            </div>
          )}
          <div className="cron-form-actions">
            <button className="cron-cancel-btn" onClick={() => setShowForm(false)}>取消</button>
            <button className="cron-submit-btn" disabled={!canSubmit} onClick={handleCreate}>
              {submitting ? "创建中..." : "创建任务"}
            </button>
          </div>
        </div>
      )}

      <div className="cron-list">
        {jobs.length === 0 && !showForm && (
          <div className="panel-empty">
            <Clock size={24} />
            <span>暂无定时任务</span>
          </div>
        )}
        {jobs.map((job) => {
          const expanded = expandedId === job.id;
          const hasErrors = job.consecutive_errors > 0;
          return (
            <div key={job.id} className={`cron-item${hasErrors ? " cron-item--error" : ""}`}>
              <div className="cron-item-header" onClick={() => setExpandedId(expanded ? null : job.id)}>
                <div className="cron-item-info">
                  <span className="cron-item-name">{job.name || job.prompt.slice(0, 30)}</span>
                  <span className="cron-item-schedule">{formatSchedule(job.schedule_kind, job.schedule_expr)}</span>
                </div>
                <div className="cron-item-meta">
                  {hasErrors && <AlertTriangle size={12} className="cron-error-icon" />}
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>
              {expanded && (
                <div className="cron-item-detail">
                  <div className="cron-detail-row">
                    <span>任务内容</span>
                    <span className="cron-detail-prompt">{job.prompt}</span>
                  </div>
                  <div className="cron-detail-row">
                    <span>执行次数</span>
                    <span>{job.run_count}</span>
                  </div>
                  <div className="cron-detail-row">
                    <span>上次执行</span>
                    <span>{formatTime(job.last_run)}</span>
                  </div>
                  {hasErrors && (
                    <div className="cron-detail-row cron-detail-row--error">
                      <span>连续错误</span>
                      <span>{job.consecutive_errors}</span>
                    </div>
                  )}
                  <button className="cron-delete-btn" onClick={() => handleDelete(job.id)}>
                    <Trash2 size={12} />
                    删除任务
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <div className="panel-error">{error}</div>}
    </div>
  );
}
