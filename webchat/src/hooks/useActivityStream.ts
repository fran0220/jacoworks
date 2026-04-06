import { useEffect, useRef, useState } from "react";
import { AUTH_TOKEN, GATEWAY_URL } from "../lib/config";

export interface ActivityStreamEvent {
  kind:
    | "task_create"
    | "task_claim"
    | "task_start"
    | "task_complete"
    | "task_failed"
    | "task_timeout";
  taskId: string;
  agentId: string;
  agentName: string;
  detail: string | null;
  ts: string;
}

const MAX_EVENTS = 50;

function isValidEvent(data: unknown): data is ActivityStreamEvent {
  if (!data || typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  return (
    typeof rec.kind === "string" &&
    typeof rec.agentId === "string" &&
    typeof rec.agentName === "string"
  );
}

export function useActivityStream(): {
  events: ActivityStreamEvent[];
  connected: boolean;
} {
  const [events, setEvents] = useState<ActivityStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const eventsRef = useRef<ActivityStreamEvent[]>([]);

  useEffect(() => {
    if (!GATEWAY_URL || !AUTH_TOKEN) return;

    const url = `${GATEWAY_URL}/api/activity/stream?token=${encodeURIComponent(AUTH_TOKEN)}`;
    const source = new EventSource(url);

    source.onopen = () => {
      setConnected(true);
    };

    source.onmessage = (msg) => {
      try {
        const parsed: unknown = JSON.parse(msg.data as string);
        if (!isValidEvent(parsed)) return;

        const next = [parsed, ...eventsRef.current].slice(0, MAX_EVENTS);
        eventsRef.current = next;
        setEvents(next);
      } catch {
        // ignore malformed messages
      }
    };

    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, []);

  return { events, connected };
}
