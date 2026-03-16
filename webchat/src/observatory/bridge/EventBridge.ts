import type { FeedLog } from "../../lib/feed";
import type { WorldEvent, WorldEventKind } from "../types";

interface RouteMapping {
  pattern: RegExp;
  kind: WorldEventKind;
  extractValue?: (body: Record<string, unknown>) => number | undefined;
}

const ROUTE_MAPPINGS: RouteMapping[] = [
  { pattern: /POST \/api\/agents\/register/, kind: "agent_spawn" },
  { pattern: /POST \/api\/tasks$/, kind: "task_create" },
  { pattern: /POST \/api\/sub-tasks\/.*\/claim/, kind: "task_claim" },
  { pattern: /POST \/api\/sub-tasks\/.*\/start/, kind: "task_start" },
  { pattern: /POST \/api\/sub-tasks\/.*\/submit/, kind: "task_submit" },
  { pattern: /POST \/api\/review-records/, kind: "task_review" },
  { pattern: /POST \/api\/sub-tasks\/.*\/complete/, kind: "task_complete" },
  { pattern: /POST \/api\/sub-tasks\/.*\/rework/, kind: "task_rework" },
  {
    pattern: /POST \/api\/scores\/adjust/,
    kind: "score_change",
    extractValue: (body) => {
      const delta = body.score_delta;
      return typeof delta === "number" ? delta : undefined;
    },
  },
];

function parseBody(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function translateFeedToWorldEvent(log: FeedLog): WorldEvent | null {
  const key = `${log.method.toUpperCase()} ${log.path}`;
  const mapping = ROUTE_MAPPINGS.find((m) => m.pattern.test(key));
  if (!mapping) return null;

  const body = parseBody(log.request_body);
  const value = mapping.extractValue?.(body);

  return {
    kind: mapping.kind,
    agentId: log.agent_id ?? "",
    agentName: log.agent_name ?? undefined,
    agentRole: log.agent_role ?? undefined,
    detail: log.request_body ?? undefined,
    value,
    timestamp: log.timestamp ? new Date(log.timestamp).getTime() : Date.now(),
  };
}

const MAX_SEEN = 200;

export class EventBridge {
  private onEvent: (event: WorldEvent) => void;
  private seenIds: Set<string> = new Set();
  private seenOrder: string[] = [];

  constructor(onEvent: (event: WorldEvent) => void) {
    this.onEvent = onEvent;
  }

  feedNewLogs(logs: FeedLog[]): void {
    for (const log of logs) {
      if (this.seenIds.has(log.id)) continue;
      this.trackId(log.id);

      const event = translateFeedToWorldEvent(log);
      if (event) this.onEvent(event);
    }
  }

  pushWsEvent(kind: WorldEventKind, agentId: string, detail?: string): void {
    const event: WorldEvent = {
      kind,
      agentId,
      detail,
      timestamp: Date.now(),
    };
    this.onEvent(event);
  }

  private trackId(id: string): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > MAX_SEEN) {
      const oldest = this.seenOrder.shift()!;
      this.seenIds.delete(oldest);
    }
  }
}
