import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "done" | "error";

export function useUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazily import the updater plugin (only available in Tauri runtime)
  const doCheck = async () => {
    if (!isTauri()) return;
    try {
      setPhase("checking");
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setInfo({ version: update.version, body: update.body ?? null });
        setPhase("available");
      } else {
        setPhase("idle");
      }
    } catch (err) {
      console.warn("[updater] check failed:", err);
      setPhase("idle");
    }
  };

  const doInstall = async () => {
    if (!isTauri()) return;
    try {
      setPhase("downloading");
      setError(null);
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setPhase("idle");
        return;
      }
      await update.downloadAndInstall();
      setPhase("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "下载更新失败";
      setError(msg);
      setPhase("error");
    }
  };

  useEffect(() => {
    // Check for updates 3 seconds after app start
    const timer = window.setTimeout(() => {
      doCheck();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return { phase, info, error, doInstall, doCheck };
}
