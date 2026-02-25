export const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL || "http://api.xiaomao.chat:8090";

export const OPENCLAW_WS_URL = import.meta.env.VITE_OPENCLAW_WS_URL || "";

export const DEFAULT_MODEL = "proxy-claude/claude-opus-4-6";

export const MODEL_OPTIONS = [
  { value: "proxy-claude/claude-opus-4-6", label: "Opus 4.6" },
  { value: "proxy-gpt/gpt-5.2", label: "GPT-5.2" },
  { value: "proxy-gemini/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { value: "proxy-grok/grok-4.20-beta", label: "Grok 4.20" },
] as const;

// ───── App Settings (localStorage) ─────────────────────────────

const SETTINGS_KEY = "jacoworks_settings";

export interface AppSettings {
  memoryEnabled: boolean;
  defaultWorkspace: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  memoryEnabled: true,
  defaultWorkspace: "",
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
