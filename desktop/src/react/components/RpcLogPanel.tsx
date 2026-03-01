import { Trash2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

interface RpcLogPayload {
  source?: string;
  line?: string;
}

interface RpcLogEntry {
  id: number;
  source: string;
  line: string;
  timestamp: number;
}

const MAX_LOG_ENTRIES = 400;

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export default function RpcLogPanel({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<RpcLogEntry[]>([]);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let stopped = false;
    let unlisten: (() => void) | null = null;

    listen<RpcLogPayload>("agent-rpc-log", (event) => {
      const line = event.payload.line?.trim();
      if (!line) return;

      const entry: RpcLogEntry = {
        id: nextId.current,
        source: event.payload.source || "stdout",
        line,
        timestamp: Date.now(),
      };
      nextId.current += 1;

      setLogs((prev) => {
        const next = [...prev, entry];
        if (next.length <= MAX_LOG_ENTRIES) return next;
        return next.slice(next.length - MAX_LOG_ENTRIES);
      });
    }).then((off) => {
      if (stopped) {
        off();
      } else {
        unlisten = off;
      }
    });

    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs]);

  const latestLogs = useMemo(() => logs.slice(-250), [logs]);

  if (!isTauri()) return null;

  return (
    <div className="rpc-log-root">
      <div className="rpc-log-panel">
        <div className="rpc-log-header">
          <strong>Agent RPC 日志</strong>
          <div className="rpc-log-actions">
            <button className="rpc-log-action" onClick={() => setLogs([])} title="清空日志">
              <Trash2 size={14} />
              清空
            </button>
            <button className="rpc-log-action" onClick={onClose} title="关闭">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="rpc-log-list" ref={listRef}>
          {latestLogs.length === 0 && <p className="rpc-log-empty">等待 sidecar 日志输出...</p>}

          {latestLogs.map((entry) => (
            <div key={entry.id} className="rpc-log-line">
              <span className="rpc-log-time">{formatTime(entry.timestamp)}</span>
              <span
                className={
                  entry.source === "stderr"
                    ? "rpc-log-source rpc-log-source-error"
                    : "rpc-log-source"
                }
              >
                {entry.source}
              </span>
              <code className="rpc-log-text">{entry.line}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
