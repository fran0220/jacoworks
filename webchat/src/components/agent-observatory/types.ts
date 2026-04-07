import type { MutableRefObject } from "react";
import type { AgentPreset, TeamsResponse } from "../../lib/teams";
import type { WorldAgent } from "../../observatory/types";

export interface ActivityItem {
  id: string;
  agentName: string;
  agentRole: string;
  action: string;
  timestamp: number;
}

export interface WsBridgeEvent {
  kind: string;
  text?: string;
  toolName?: string;
}

export interface AgentObservatoryProps {
  onWsEvent?: MutableRefObject<((event: WsBridgeEvent) => void) | null>;
  activeTeamSessionKey: string;
  onTeamChange: (sessionKey: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  connState: "disconnected" | "connecting" | "connected";
}

export interface TeamDataState {
  teamsData: TeamsResponse | null;
  presets: AgentPreset[];
}

export interface SceneRefs {
  scene: InstanceType<
    typeof import("../../observatory/world/ObservatoryScene").ObservatoryScene
  >;
  env: { update(time: number): void };
  zones: InstanceType<
    typeof import("../../observatory/world/ZoneManager").ZoneManager
  >;
  pool: InstanceType<typeof import("../../observatory/avatar/AvatarPool").AvatarPool>;
  factory: InstanceType<
    typeof import("../../observatory/avatar/AvatarFactory").AvatarFactory
  >;
  waypointGraph: InstanceType<
    typeof import("../../observatory/world/WaypointGraph").WaypointGraph
  >;
  stateManager: InstanceType<
    typeof import("../../observatory/bridge/AgentStateManager").AgentStateManager
  >;
  eventBridge: InstanceType<
    typeof import("../../observatory/bridge/EventBridge").EventBridge
  >;
  worldAgents: Map<string, WorldAgent>;
  navigators: Map<
    string,
    InstanceType<
      typeof import("../../observatory/avatar/AvatarNavigator").AvatarNavigator
    >
  >;
  animators: Map<
    string,
    InstanceType<
      typeof import("../../observatory/avatar/AvatarAnimator").AvatarAnimator
    >
  >;
}
