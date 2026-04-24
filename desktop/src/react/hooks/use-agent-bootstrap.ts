import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAgentConfig } from "../lib/auth";
import type { AgentTransport } from "../lib/agent-transport";
import {
  deriveGatewayModelState,
  EMPTY_GATEWAY_MODEL_STATE,
  ensureDefaultWorkspace,
  getSettings,
  type GatewayModelState,
} from "../lib/config";
import { LocalSidecarTransport } from "../lib/local-sidecar-transport";
import { setSkills } from "../lib/skills";
import { checkAndUpdateTools } from "../lib/tool-updater";

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
  const [gatewayModelState, setGatewayModelState] = useState<GatewayModelState>(EMPTY_GATEWAY_MODEL_STATE);
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
      setGatewayModelState(EMPTY_GATEWAY_MODEL_STATE);
      clearTransport();
      return;
    }

    let cancelled = false;

    if (!isTauriEnv) {
      setBootstrapDone(false);
      setBootstrapError("当前版本仅支持 Tauri 运行时");
      setGatewayModelState(EMPTY_GATEWAY_MODEL_STATE);
      clearTransport();
      return;
    }

    clearTransport();
    setBootstrapDone(false);
    setBootstrapError(null);

    let pendingTransport: LocalSidecarTransport | null = null;

    withTimeout((async () => {
      await ensureDefaultWorkspace();

      const agentConfig = await fetchAgentConfig();
      setGatewayModelState(deriveGatewayModelState({
        models: agentConfig.models,
        primaryModel: agentConfig.primary_model,
        primaryProvider: agentConfig.primary_provider,
      }));

      // Fire-and-forget: update CLI tools in background (takes effect next launch)
      checkAndUpdateTools(agentConfig.tools_manifest).catch((err) =>
        console.warn("[agent-boot] CLI tool update failed:", err),
      );
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
      if (agentConfig.mineru_token) envVars.MINERU_TOKEN = agentConfig.mineru_token;
      if (agentConfig.jimeng_api_url) envVars.JIMENG_API_URL = agentConfig.jimeng_api_url;
      if (agentConfig.jimeng_api_key) envVars.JIMENG_API_KEY = agentConfig.jimeng_api_key;
      if (agentConfig.asset_gateway_token) envVars.ASSET_GATEWAY_TOKEN = agentConfig.asset_gateway_token;
      if (agentConfig.asset_gateway_url) envVars.ASSET_GATEWAY_URL = agentConfig.asset_gateway_url;
      if (agentConfig.ai_search_gateway_url) envVars.AI_SEARCH_GATEWAY_URL = agentConfig.ai_search_gateway_url;
      if (agentConfig.ai_search_token) envVars.AI_SEARCH_TOKEN = agentConfig.ai_search_token;
      if (agentConfig.models?.length) envVars.LLM_MODELS_JSON = JSON.stringify(agentConfig.models);
      if (agentConfig.primary_model) {
        if (agentConfig.primary_model.includes("/")) {
          const [provider, model] = agentConfig.primary_model.split("/", 2);
          if (provider && model) {
            envVars.PRIMARY_PROVIDER = provider;
            envVars.PRIMARY_MODEL = model;
          }
        } else {
          envVars.PRIMARY_MODEL = agentConfig.primary_model;
        }
      }
      if (agentConfig.primary_provider) envVars.PRIMARY_PROVIDER = agentConfig.primary_provider;

      if (cancelled) return;

      const nextTransport = new LocalSidecarTransport({
        agentDir: "vm-agent",
        envVars,
      });
      pendingTransport = nextTransport;
      await nextTransport.connect();

      if (cancelled) {
        nextTransport.close();
        return;
      }

      pendingTransport = null;
      transportRef.current = nextTransport;
      setTransport(nextTransport);

      // Use skills from sidecar ready event — this is the actual LLM-visible skill list.
      setSkills(nextTransport.loadedSkills);
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
      // StrictMode cleanup: close any in-flight transport to prevent killing the next one
      if (pendingTransport) {
        pendingTransport.close();
        pendingTransport = null;
      }
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
    gatewayModelState,
    retryBootstrap: () => setBootstrapNonce((value) => value + 1),
  };
}
