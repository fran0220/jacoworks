import {
  Brain,
  Check,
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
  web_search: { label: "正在搜索网页", doneLabel: "搜索完成", icon: Search },
  web_fetch: { label: "正在读取网页", doneLabel: "读取完成", icon: Globe },
  read: { label: "正在读取文件", doneLabel: "读取完成", icon: FileSearch },
  write: { label: "正在写入文件", doneLabel: "写入完成", icon: FileCode2 },
  edit: { label: "正在编辑文件", doneLabel: "编辑完成", icon: FileCode2 },
  bash: { label: "正在执行命令", doneLabel: "执行完成", icon: Terminal },
  grep: { label: "正在搜索内容", doneLabel: "搜索完成", icon: Search },
  find: { label: "正在查找文件", doneLabel: "查找完成", icon: FolderSearch },
  ls: { label: "正在列出目录", doneLabel: "列出完成", icon: FolderSearch },
  memory_search: { label: "正在搜索记忆", doneLabel: "搜索完成", icon: Brain },
  memory_save: { label: "正在保存记忆", doneLabel: "保存完成", icon: Brain },
  cron_manage: { label: "正在管理定时任务", doneLabel: "任务完成", icon: Clock3 },
};

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
  const meta = toolMeta[toolName] ?? {
    label: `正在使用 ${toolName}`,
    doneLabel: `${toolName} 完成`,
    icon: Wrench,
  };
  const Icon = meta.icon;
  const isRunning = status === "running";
  const isError = status === "error";

  return (
    <div className={`tool-status ${isRunning ? "" : "tool-done"}`}>
      <Icon size={14} className="tool-icon" />
      <span className="label">
        {isRunning ? meta.label : isError ? `${meta.doneLabel} (错误)` : meta.doneLabel}
      </span>
      {isRunning ? (
        <span className="spinner" />
      ) : isError ? (
        <X size={12} className="tool-error-icon" />
      ) : (
        <Check size={12} className="tool-check-icon" />
      )}
      {(args !== undefined || output) && (
        <div className="tool-detail">
          {args !== undefined && <pre>{safeStringify(args)}</pre>}
          {output && <pre>{output}</pre>}
        </div>
      )}
    </div>
  );
}
