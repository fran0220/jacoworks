export const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL || "https://jacoapi.jingao.club";

export const COWORK_WS_URL =
  import.meta.env.VITE_COWORK_WS_URL || "wss://jacoapi.jingao.club";

export const DEFAULT_MODEL = "proxy-claude/claude-opus-4-6";

export const MODEL_OPTIONS = [
  { value: "proxy-claude/claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "proxy-claude/claude-opus-4-6", label: "Opus 4.6" },
  { value: "proxy-gpt/gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "proxy-gpt/gpt-5.4", label: "GPT-5.4" },
  { value: "proxy-gemini/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { value: "proxy-gemini/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "proxy-glm/glm-5", label: "GLM-5" },
] as const;

export const THINKING_LEVELS = [
  { value: "off", label: "关闭" },
  { value: "minimal", label: "最少" },
  { value: "low", label: "低" },
  { value: "medium", label: "中等" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "最高" },
] as const;

// ───── App Settings (localStorage) ─────────────────────────────

const SETTINGS_KEY = "jacoworks_settings";

export interface AppSettings {
  memoryEnabled: boolean;
  memorySyncEnabled: boolean;
  defaultWorkspace: string;
  defaultModel: string;
  thinkingLevel: string;
  debugLogEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  memoryEnabled: true,
  memorySyncEnabled: false,
  defaultWorkspace: "",
  defaultModel: DEFAULT_MODEL,
  thinkingLevel: "medium",
  debugLogEnabled: false,
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function updateSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ───── Default workspace bootstrap (同步根目录) ─────────────────

/**
 * 首次启动时自动设置同步根目录 (~/Documents/JAcoworks)。
 * 容器文件同步到此目录下，按会话 ID 隔离子文件夹。
 * 如果用户已手动设置过则跳过。
 */
export async function ensureDefaultWorkspace(): Promise<void> {
  const settings = getSettings();
  if (settings.defaultWorkspace) return; // 已设置, 跳过

  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri()) return;
    const path: string = await invoke("ensure_default_workspace");
    updateSettings({ ...settings, defaultWorkspace: path });
  } catch (err) {
    console.warn("[config] Failed to set default workspace:", err);
  }
}

/**
 * 返回按会话隔离的同步子目录路径: {syncRoot}/{sessionId}/
 */
export function getSessionSyncDir(syncRoot: string, sessionId: string): string {
  return `${syncRoot}/${sessionId}`;
}
