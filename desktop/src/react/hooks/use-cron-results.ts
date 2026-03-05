import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface CronResultItem {
  jobId: string;
  jobName?: string;
  status: "ok" | "error";
  durationMs: number;
  resultPreview?: string;
  error?: string;
  timestamp: number;
}

const MAX_RESULTS = 50;

export function useCronResults() {
  const [results, setResults] = useState<CronResultItem[]>([]);

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;

    listen<Record<string, unknown>>("agent-rpc-event", (event) => {
      const packet = event.payload;
      if (packet.type !== "cron_result") return;

      const item: CronResultItem = {
        jobId: (packet.jobId as string) || "",
        jobName: packet.jobName as string | undefined,
        status: (packet.status as "ok" | "error") || "error",
        durationMs: (packet.durationMs as number) || 0,
        resultPreview: packet.resultPreview as string | undefined,
        error: packet.error as string | undefined,
        timestamp: (packet.timestamp as number) || Date.now(),
      };

      setResults((prev) => [item, ...prev].slice(0, MAX_RESULTS));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const clearResults = () => setResults([]);

  return { results, clearResults };
}
