export const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL || "https://jacoapi.jingao.club";

export const COWORK_WS_URL =
  import.meta.env.VITE_COWORK_WS_URL || "wss://jacoapi.jingao.club";

const LEGACY_FOLLOW_GATEWAY_MODEL = "proxy-claude/claude-opus-4-6";

export interface ModelOption {
  value: string;
  label: string;
}

export interface GatewayModelState {
  modelOptions: ModelOption[];
  serverDefaultModel: string;
}

export const EMPTY_GATEWAY_MODEL_STATE: GatewayModelState = {
  modelOptions: [],
  serverDefaultModel: "",
};

export function deriveGatewayModelState(input: {
  models?: Array<{ id: string; provider: string; label: string }>;
  primaryModel?: string;
  primaryProvider?: string;
}): GatewayModelState {
  const modelOptions = (input.models ?? []).map((model) => ({
    value: `${model.provider}/${model.id}`,
    label: model.label,
  }));

  let serverDefaultModel = "";
  if (input.primaryModel && input.primaryProvider) {
    serverDefaultModel = `${input.primaryProvider}/${input.primaryModel}`;
  } else if (input.primaryModel) {
    serverDefaultModel = input.primaryModel;
  }

  if (!serverDefaultModel && modelOptions.length > 0) {
    serverDefaultModel = modelOptions[0].value;
  }

  return { modelOptions, serverDefaultModel };
}

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
  defaultModelPinned: boolean;
  defaultModel: string;
  thinkingLevel: string;
  debugLogEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  memoryEnabled: true,
  memorySyncEnabled: false,
  defaultWorkspace: "",
  defaultModelPinned: false,
  defaultModel: "",
  thinkingLevel: "medium",
  debugLogEnabled: false,
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const merged: AppSettings = { ...DEFAULT_SETTINGS, ...parsed };

    // Backward compatibility for versions that only stored defaultModel.
    // The old desktop hardcoded Claude Opus 4.6 as its implicit "follow gateway" value.
    if (typeof parsed.defaultModelPinned !== "boolean") {
      const legacyModel = typeof parsed.defaultModel === "string" ? parsed.defaultModel.trim() : "";
      if (legacyModel && legacyModel !== LEGACY_FOLLOW_GATEWAY_MODEL) {
        merged.defaultModel = legacyModel;
        merged.defaultModelPinned = true;
      } else {
        merged.defaultModel = "";
        merged.defaultModelPinned = false;
      }
    }

    if (merged.defaultModelPinned && !merged.defaultModel.trim()) {
      merged.defaultModelPinned = false;
    }

    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function updateSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getEffectiveDefaultModel(
  settings: AppSettings = getSettings(),
  gatewayModelState: GatewayModelState = EMPTY_GATEWAY_MODEL_STATE,
): string {
  if (settings.defaultModelPinned && settings.defaultModel.trim()) {
    return settings.defaultModel;
  }
  return gatewayModelState.serverDefaultModel || gatewayModelState.modelOptions[0]?.value || "";
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
