import type { VillageAgentModel } from "../VillageAgent";
import type { VillageZoneId } from "../VillageZone";

export interface VillageZoneEffect {
  reserveCount: number;
  reservedPaths: string[];
}

export interface UseVillageBridgeResult {
  agents: VillageAgentModel[];
  activeCount: number;
  latestStory: string;
  highlightedAgentId: string | null;
  zoneEffects: Partial<Record<VillageZoneId, VillageZoneEffect>>;
}

export type VillageEventKind =
  | "task_create"
  | "task_claim"
  | "task_start"
  | "task_submit"
  | "task_review"
  | "task_complete"
  | "task_rework"
  | "task_failed"
  | "task_timeout"
  | "file_reserve"
  | "message_dm"
  | "message_broadcast"
  | "thinking"
  | "idle";

export interface VillageActivityEvent {
  kind: VillageEventKind;
  agentId: string;
  agentName: string;
  detailText: string | null;
  timestamp: string | null;
  story: string;
}
