import {
  Brain,
  Clock3,
  FileCode2,
  FileSearch,
  FolderSearch,
  Globe,
  type LucideIcon,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";

const toolMeta: Record<string, { label: string; icon: LucideIcon }> = {
  web_search: { label: "正在搜索网页", icon: Search },
  web_fetch: { label: "正在读取网页", icon: Globe },
  read: { label: "正在读取文件", icon: FileSearch },
  write: { label: "正在写入文件", icon: FileCode2 },
  edit: { label: "正在编辑文件", icon: FileCode2 },
  bash: { label: "正在执行命令", icon: Terminal },
  grep: { label: "正在搜索内容", icon: Search },
  find: { label: "正在查找文件", icon: FolderSearch },
  ls: { label: "正在列出目录", icon: FolderSearch },
  memory_search: { label: "正在搜索记忆", icon: Brain },
  memory_save: { label: "正在保存记忆", icon: Brain },
  cron_manage: { label: "正在管理定时任务", icon: Clock3 },
};

export default function ToolStatus({ toolName }: { toolName: string }) {
  const meta = toolMeta[toolName] ?? { label: `正在使用 ${toolName}`, icon: Wrench };
  const Icon = meta.icon;

  return (
    <div className="tool-status">
      <Icon size={14} className="tool-icon" />
      <span className="label">{meta.label}</span>
      <span className="spinner" />
    </div>
  );
}
