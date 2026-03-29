import { useState } from "react";
import {
  Brain,
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  FileSearch,
  FolderSearch,
  Globe,
  type LucideIcon,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";

const toolMeta: Record<string, { label: string; doneLabel: string; icon: LucideIcon }> = {
  web_search: { label: "搜索网页", doneLabel: "搜索完成", icon: Search },
  web_fetch: { label: "读取网页", doneLabel: "读取完成", icon: Globe },
  read: { label: "读取文件", doneLabel: "读取完成", icon: FileSearch },
  write: { label: "写入文件", doneLabel: "写入完成", icon: FileCode2 },
  edit: { label: "编辑文件", doneLabel: "编辑完成", icon: FileCode2 },
  bash: { label: "执行命令", doneLabel: "执行完成", icon: Terminal },
  grep: { label: "搜索内容", doneLabel: "搜索完成", icon: Search },
  find: { label: "查找文件", doneLabel: "查找完成", icon: FolderSearch },
  ls: { label: "列出目录", doneLabel: "列出完成", icon: FolderSearch },
  memory_search: { label: "搜索记忆", doneLabel: "搜索完成", icon: Brain },
  memory_save: { label: "保存记忆", doneLabel: "保存完成", icon: Brain },
  cron_manage: { label: "管理定时任务", doneLabel: "任务完成", icon: Clock3 },
};

function briefArg(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  // Show the most relevant single field as a brief hint
  const path = obj.path ?? obj.file ?? obj.query ?? obj.command ?? obj.url ?? obj.pattern ?? "";
  if (typeof path === "string" && path) {
    const short = path.length > 60 ? "…" + path.slice(-55) : path;
    return short;
  }
  return "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ToolStatus({
  toolName,
  status = "running",
  args,
  output,
}: {
  toolName: string;
  status?: "running" | "completed" | "error";
  args?: unknown;
  output?: string;
}) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta[toolName] ?? {
    label: toolName,
    doneLabel: `${toolName} 完成`,
    icon: Wrench,
  };
  const Icon = meta.icon;
  const isRunning = status === "running";
  const isError = status === "error";
  const hint = briefArg(args);
  const hasDetail = args !== undefined || !!output;

  return (
    <div className={`tool-status${isRunning ? "" : " tool-done"}`}>
      <button
        className="tool-status-row"
        onClick={() => hasDetail && setOpen(!open)}
        disabled={!hasDetail}
      >
        <Icon size={13} className="tool-icon" />
        <span className="tool-label">
          {isRunning ? meta.label : isError ? `${meta.doneLabel} (错误)` : meta.doneLabel}
        </span>
        {hint && <span className="tool-hint">{hint}</span>}
        {isRunning ? (
          <span className="spinner" />
        ) : isError ? (
          <X size={11} className="tool-error-icon" />
        ) : (
          <Check size={11} className="tool-check-icon" />
        )}
        {hasDetail && (
          <ChevronRight size={11} className={`tool-chevron${open ? " open" : ""}`} />
        )}
      </button>
      {open && (
        <div className="tool-detail">
          {args !== undefined && <pre>{safeStringify(args)}</pre>}
          {output && <pre>{output}</pre>}
        </div>
      )}
    </div>
  );
}
