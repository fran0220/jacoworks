export const PRESET_DESCRIPTIONS: Record<string, string> = {
  default: "通用单 Agent 模式，适合日常问答、快速执行和自由探索。",
  researcher: "偏研究与事实核验，适合检索、比对来源和形成结构化结论。",
  coder: "偏工程实现，关注正确性、边界条件、可维护性与验证步骤。",
  writer: "偏内容表达，擅长结构组织、语气适配和更自然的成稿输出。",
};

export const ICON_OPTIONS = [
  { value: "bot", label: "🤖 Bot" },
  { value: "sparkles", label: "✨ Sparkles" },
  { value: "pen-tool", label: "✏️ Pen Tool" },
];

export const KNOWN_FILES = [
  { key: "SOUL.md", label: "性格 (SOUL)" },
  { key: "IDENTITY.md", label: "身份 (IDENTITY)" },
  { key: "USER.md", label: "用户 (USER)" },
  { key: "AGENTS.md", label: "工作指引 (AGENTS)" },
  { key: "TOOLS.md", label: "工具 (TOOLS)" },
  { key: "HEARTBEAT.md", label: "心跳 (HEARTBEAT)" },
  { key: "MEMORY.md", label: "记忆 (MEMORY)" },
];
