import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAgentConfig } from "../lib/auth";
import type { AgentTransport } from "../lib/agent-transport";
import { ensureDefaultWorkspace, getSettings } from "../lib/config";
import { LocalSidecarTransport } from "../lib/local-sidecar-transport";
import { fetchSkills, setSkills } from "../lib/skills";

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
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [transport, setTransport] = useState<AgentTransport | null>(null);
  const transportRef = useRef<AgentTransport | null>(null);
  const isTauriEnv = useMemo(() => isTauri(), []);

  const clearTransport = () => {
    transportRef.current?.close();
    transportRef.current = null;
    setTransport(null);
  };

  useEffect(() => {
    if (!authenticated) {
      setBootstrapDone(false);
      setBootstrapError(null);
      clearTransport();
      return;
    }

    let cancelled = false;

    if (!isTauriEnv) {
      setBootstrapDone(false);
      setBootstrapError("当前版本仅支持 Tauri 运行时");
      clearTransport();
      return;
    }

    clearTransport();
    setBootstrapDone(false);
    setBootstrapError(null);

    withTimeout((async () => {
      await ensureDefaultWorkspace();

      const agentConfig = await fetchAgentConfig();
      const settings = getSettings();
      const envVars: Record<string, string> = {
        LLM_PROXY_URL: agentConfig.llm_proxy_url,
        LLM_PROXY_KEY: agentConfig.llm_proxy_key,
        WORKSPACE_DIR: settings.defaultWorkspace,
      };

      if (agentConfig.openai_api_key) envVars.OPENAI_API_KEY = agentConfig.openai_api_key;
      if (agentConfig.exa_api_key) envVars.EXA_API_KEY = agentConfig.exa_api_key;
      if (agentConfig.tavily_api_key) envVars.TAVILY_API_KEY = agentConfig.tavily_api_key;
      if (agentConfig.embedding_base_url) envVars.EMBEDDING_BASE_URL = agentConfig.embedding_base_url;
      if (agentConfig.embedding_api_key) envVars.EMBEDDING_API_KEY = agentConfig.embedding_api_key;
      if (agentConfig.fal_api_key) envVars.FAL_API_KEY = agentConfig.fal_api_key;
      if (agentConfig.jimeng_api_url) envVars.JIMENG_API_URL = agentConfig.jimeng_api_url;
      if (agentConfig.jimeng_api_key) envVars.JIMENG_API_KEY = agentConfig.jimeng_api_key;

      const nextTransport = new LocalSidecarTransport({
        agentDir: "vm-agent",
        envVars,
      });
      await nextTransport.connect();

      if (cancelled) {
        nextTransport.close();
        return;
      }

      transportRef.current = nextTransport;
      setTransport(nextTransport);

      // Fetch skill list from gateway DB to populate SkillMenu.
      const skills = await fetchSkills().catch((err) => {
        console.warn("[boot] fetch skills failed:", err);
        return [];
      });
      setSkills(skills);
    })(), 30_000, "本地 Agent 初始化超时，请重试")
      .then(() => {
        if (cancelled) return;
        setBootstrapDone(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "本地 Agent 初始化失败";
        console.error("[agent-boot] startup failed:", err);
        clearTransport();
        setBootstrapError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, isTauriEnv, bootstrapNonce]);

  useEffect(() => {
    return () => {
      clearTransport();
    };
  }, []);

  return {
    bootstrapDone,
    bootstrapError,
    transport,
    retryBootstrap: () => setBootstrapNonce((value) => value + 1),
  };
}
