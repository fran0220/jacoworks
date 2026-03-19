import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ConfigModule = typeof import("../config");

function createStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(seed));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

async function loadConfig(): Promise<ConfigModule> {
  return import("../config");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  Object.defineProperty(globalThis, "localStorage", {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  test("reads GATEWAY_URL from env", async () => {
    vi.stubEnv("VITE_GATEWAY_URL", "http://localhost:8847");

    const config = await loadConfig();
    expect(config.GATEWAY_URL).toBe("http://localhost:8847");
  });

  test("DEFAULT_MODEL parses into provider/model", async () => {
    const config = await loadConfig();
    const [provider, model] = config.DEFAULT_MODEL.split("/");

    expect(provider).toBe("proxy-claude");
    expect(model.length).toBeGreaterThan(0);
    expect(config.MODEL_OPTIONS.some((option) => option.value === config.DEFAULT_MODEL)).toBe(true);
  });

  test("falls back to defaults when env or storage is invalid", async () => {
    vi.stubEnv("VITE_GATEWAY_URL", "");
    Object.defineProperty(globalThis, "localStorage", {
      value: createStorage({ jacoworks_settings: "{broken-json" }),
      writable: true,
      configurable: true,
    });

    const config = await loadConfig();
    expect(config.GATEWAY_URL).toBe("https://jacoapi.jingao.club");
    expect(config.getSettings()).toMatchObject({
      memoryEnabled: true,
      defaultWorkspace: "",
      defaultModelPinned: false,
      defaultModel: "",
      thinkingLevel: "medium",
      debugLogEnabled: false,
    });
    expect(config.getEffectiveDefaultModel(config.getSettings())).toBe(config.DEFAULT_MODEL);
  });

  test("legacy default model migrates to follow gateway mode", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createStorage({
        jacoworks_settings: JSON.stringify({
          defaultModel: "proxy-claude/claude-opus-4-6",
        }),
      }),
      writable: true,
      configurable: true,
    });

    const config = await loadConfig();
    const settings = config.getSettings();
    expect(settings.defaultModelPinned).toBe(false);
    expect(settings.defaultModel).toBe("");
    expect(config.getEffectiveDefaultModel(settings)).toBe(config.DEFAULT_MODEL);
  });

  test("legacy custom default model migrates to pinned mode", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createStorage({
        jacoworks_settings: JSON.stringify({
          defaultModel: "proxy-gpt/gpt-5.4",
        }),
      }),
      writable: true,
      configurable: true,
    });

    const config = await loadConfig();
    const settings = config.getSettings();
    expect(settings.defaultModelPinned).toBe(true);
    expect(settings.defaultModel).toBe("proxy-gpt/gpt-5.4");
    expect(config.getEffectiveDefaultModel(settings)).toBe("proxy-gpt/gpt-5.4");
  });
});
