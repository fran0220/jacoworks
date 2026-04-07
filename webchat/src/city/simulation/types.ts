import type { CityAgentState, CityFacing } from "../CityAgent";
import type { CityPoint, CityZoneId } from "../CityZone";

export type CitizenType =
  | "resident"
  | "merchant"
  | "venue_operator"
  | "robot"
  | "developer"
  | "official"
  | "creator";

export interface CitizenTypeInfo {
  typeLabel: string;
  accent: string;
  homeZones: CityZoneId[];
  behaviors: string[];
}

export interface CityCitizen {
  id: string;
  name: string;
  type: CitizenType;
  typeLabel: string;
  accent: string;
  homeZoneId: CityZoneId;
  description: string;
}

export interface SimAgent {
  citizen: CityCitizen;
  zoneId: CityZoneId;
  slotIndex: number;
  state: CityAgentState;
  statusText: string;
  position: CityPoint;
  facing: CityFacing;
  dwellUntil: number;
  moving: boolean;
  moveFrom: CityPoint | null;
  moveTo: CityPoint | null;
  moveStartedAt: number;
}

export interface SimulationAgentOutput {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  state: "idle" | "walking" | "working" | "thinking" | "reviewing" | "celebrating";
  statusText: string;
  detailText?: string | null;
  accent: string;
  lngLat: [number, number];
  facing?: "down" | "up" | "right" | "left";
  spritePackId: string;
}

export interface UseCitySimulationResult {
  agents: SimulationAgentOutput[];
  highlightedAgentId: string | null;
  latestStory: string;
  activeCount: number;
}
