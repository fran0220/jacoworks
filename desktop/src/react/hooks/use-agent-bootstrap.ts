import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { fetchAgentConfig } from "../lib/auth";
import { getSettings } from "../lib/config";
import { setSkills } from "../lib/skills";
import { syncSkills } from "../lib/skill-sync";

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export function useAgentBootstrap(authenticated: boolean) {
  const [agentBootNonce, setAgentBootNonce] = useState(0);
  const [agentStarting, setAgentStarting] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const isTauriEnv = useMemo(() => isTauri(), []);

  useEffect(() => {
    if (!authenticated) return;

    let cancelled = false;

    if (!isTauriEnv) {
      setAgentStarting(false);
      setAgentError("当前版本仅支持 Tauri 运行时（RPC sidecar）");
      return;
    }

    setAgentStarting(true);
    setAgentError(null);

    // Capture skills from the ready event before start_agent resolves
    let unlistenSkills: (() => void) | null = null;
    const skillsReady = listen<{ type?: string; skills?: unknown[] }>("agent-rpc-event", (event) => {
      const p = event.payload;
      if (p.type === "ready" && Array.isArray(p.skills)) {
        setSkills(p.skills as never[]);
        unlistenSkills?.();
      }
    }).then((fn) => { unlistenSkills = fn; });

    withTimeout(
      (async () => {
        await skillsReady;
        const appSettings = getSettings();
        const envVars: Record<string, string> = {
          MEMORY_ENABLED: appSettings.memoryEnabled ? "true" : "false",
        };

        const config = await fetchAgentConfig();
        envVars.LLM_PROXY_URL = config.llm_proxy_url;
        envVars.LLM_PROXY_KEY = config.llm_proxy_key;
        if (config.openai_api_key) envVars.OPENAI_API_KEY = config.openai_api_key;
        if (config.exa_api_key) envVars.EXA_API_KEY = config.exa_api_key;
        if (config.tavily_api_key) envVars.TAVILY_API_KEY = config.tavily_api_key;
        if (config.embedding_base_url) envVars.EMBEDDING_BASE_URL = config.embedding_base_url;
        if (config.embedding_api_key) envVars.EMBEDDING_API_KEY = config.embedding_api_key;

        await invoke("start_agent", {
          agentDir: import.meta.env.VITE_AGENT_DIR || "../vm-agent",
          envVars,
        });

        // Agent started — sync skills to gateway in background
        syncSkills().catch((err) =>
          console.warn("[boot] skills sync failed:", err),
        );
      })(),
      20_000,
      "Agent 启动超时，请点击右下角 RPC 日志排查",
    )
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Agent 启动失败";
        console.error("[agent-boot] startup failed:", err);
        setAgentError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setAgentStarting(false);
      });

    return () => {
      cancelled = true;
      unlistenSkills?.();
    };
  }, [authenticated, isTauriEnv, agentBootNonce]);

  return {
    agentStarting,
    agentError,
    retryAgent: () => setAgentBootNonce((value) => value + 1),
  };
}
