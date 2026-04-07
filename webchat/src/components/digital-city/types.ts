import type { Marker } from "mapbox-gl";
import type { VillageAgentState } from "../../village/VillageAgent";

export type CityZoneIcon = "trophy" | "building" | "radar" | "activity";

export type ControlRoleId =
  | "yicheng"
  | "esports"
  | "lifestyle"
  | "cheerleader"
  | "sentinel";

export interface CityZoneDefinition {
  id: string;
  label: string;
  caption: string;
  lngLat: [number, number];
  icon: CityZoneIcon;
  accent: string;
}

export interface ControlRoleDefinition {
  id: ControlRoleId;
  name: string;
  title: string;
  cadence: string;
  mission: string;
  signalLabel: string;
  infoFlow: string;
  accent: string;
  primaryZoneId: CityZoneDefinition["id"];
  relatedZoneIds: CityZoneDefinition["id"][];
}

export interface CityAgentModel {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  state: VillageAgentState;
  statusText: string;
  detailText?: string | null;
  accent: string;
  lngLat: [number, number];
  spritePackId?: string;
}

export interface CityAgentMarkerRecord {
  marker: Marker;
  element: HTMLDivElement;
  labelEl: HTMLDivElement;
  nameEl: HTMLElement;
  statusEl: HTMLSpanElement;
  detailEl: HTMLElement;
  nodeEl: HTMLDivElement;
  currentLngLat: [number, number];
}

export interface CityZoneSnapshot {
  zone: CityZoneDefinition;
  owner: ControlRoleDefinition;
  nodeCount: number;
  activeNodeCount: number;
  headline: string;
}

export interface CityLaneSnapshot extends ControlRoleDefinition {
  liveNode: CityAgentModel | null;
  liveZone: CityZoneDefinition;
  nodeCount: number;
  activeNodeCount: number;
  signalText: string;
}
