import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { fetchAgentConfig } from "../lib/auth";
import { ensureDefaultWorkspace } from "../lib/config";
import { syncUserSkills } from "../lib/skill-sync";

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
  const isTauriEnv = useMemo(() => isTauri(), []);

  useEffect(() => {
    if (!authenticated) {
      setBootstrapDone(false);
      setBootstrapError(null);
      return;
    }

    let cancelled = false;

    if (!isTauriEnv) {
      setBootstrapDone(false);
      setBootstrapError("当前版本仅支持 Tauri 运行时");
      return;
    }

    setBootstrapDone(false);
    setBootstrapError(null);

    withTimeout((async () => {
      await ensureDefaultWorkspace();

      // Keep this call during cloud-only migration: gateway validates and provides
      // the active model proxy configuration used by containers.
      await fetchAgentConfig();

      // Push user skills to gateway so cloud containers can consume them.
      await syncUserSkills().catch((err) => {
        console.warn("[boot] user skill push failed:", err);
      });
    })(), 20_000, "云端初始化超时，请重试")
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
              : "云端初始化失败";
        console.error("[cloud-boot] startup failed:", err);
        setBootstrapError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, isTauriEnv, bootstrapNonce]);

  return {
    bootstrapDone,
    bootstrapError,
    retryBootstrap: () => setBootstrapNonce((value) => value + 1),
  };
}
