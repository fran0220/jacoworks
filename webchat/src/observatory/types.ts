import type * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

const ROLE_OVERRIDES_GLOBAL_KEY = "__JACOWORKS_OBSERVATORY_ROLE_OVERRIDES__";
const ZONE_LABELS_GLOBAL_KEY = "__JACOWORKS_OBSERVATORY_ZONE_LABELS__";

type ThemeRoleOverride = Pick<RoleConfig, "color" | "emissive" | "namePrefix"> & {
  homeZone?: string;
  idleZone?: string;
};

function getThemeRoleOverride(role: string): ThemeRoleOverride | undefined {
  const globalState = globalThis as Record<string, unknown>;
  const overrides = globalState[ROLE_OVERRIDES_GLOBAL_KEY];
  if (!overrides || typeof overrides !== "object") return undefined;
  const record = overrides as Record<string, ThemeRoleOverride>;
  return record[role];
}

function getThemeZoneLabel(zoneId: string): string | undefined {
  const globalState = globalThis as Record<string, unknown>;
  const labels = globalState[ZONE_LABELS_GLOBAL_KEY];
  if (!labels || typeof labels !== "object") return undefined;
  const record = labels as Record<string, string>;
  return record[zoneId];
}

export function setThemeRoleOverrides(overrides: Record<string, Partial<RoleConfig>> | null): void {
  const globalState = globalThis as Record<string, unknown>;
  globalState[ROLE_OVERRIDES_GLOBAL_KEY] = overrides;
}

export function setThemeZoneLabels(labels: Record<string, string> | null): void {
  const globalState = globalThis as Record<string, unknown>;
  globalState[ZONE_LABELS_GLOBAL_KEY] = labels;
}

// ── Role System ──────────────────────────────────────────

export interface RoleConfig {
  role: string;
  color: number;
  emissive: number;
  homeZone: ZoneId;
  idleZone: ZoneId;
  namePrefix: string;
}

export const ROLE_CONFIGS: Record<string, RoleConfig> = {
  planner:  { role: "planner",  color: 0x3b82f6, emissive: 0x1d4ed8, homeZone: "tower",        idleZone: "lounge", namePrefix: "玲" },
  executor: { role: "executor", color: 0xf97316, emissive: 0xc2410c, homeZone: "forge",        idleZone: "lounge", namePrefix: "凯" },
  reviewer: { role: "reviewer", color: 0x22c55e, emissive: 0x15803d, homeZone: "court",        idleZone: "lounge", namePrefix: "言" },
  patrol:   { role: "patrol",   color: 0xa855f7, emissive: 0x7e22ce, homeZone: "patrol_path",  idleZone: "lounge", namePrefix: "夜" },
};

export function getRoleConfig(role: string): RoleConfig {
  const override = getThemeRoleOverride(role);
  if (override) {
    const base = ROLE_CONFIGS[role];
    if (base) {
      return { ...base, ...override } as RoleConfig;
    }
    const hue = hashStringToHue(role);
    return {
      role,
      color: override.color ?? hslToHex(hue, 0.7, 0.55),
      emissive: override.emissive ?? hslToHex(hue, 0.8, 0.35),
      homeZone: (override.homeZone as ZoneId | undefined) ?? "lounge",
      idleZone: (override.idleZone as ZoneId | undefined) ?? "lounge",
      namePrefix: override.namePrefix ?? role.slice(0, 1).toUpperCase(),
    };
  }
  if (ROLE_CONFIGS[role]) return ROLE_CONFIGS[role];
  const hue = hashStringToHue(role);
  const color = hslToHex(hue, 0.7, 0.55);
  const emissive = hslToHex(hue, 0.8, 0.35);
  return { role, color, emissive, homeZone: "lounge", idleZone: "lounge", namePrefix: role.slice(0, 1).toUpperCase() };
}

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return ((hash % 360) + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

export function getZoneLabel(zoneId: ZoneId): string {
  return getThemeZoneLabel(zoneId) ?? zoneId;
}

// ── Zones ────────────────────────────────────────────────

export type ZoneId = "tower" | "forge" | "court" | "lounge" | "patrol_path" | "hub";

export interface ZoneSlot {
  position: THREE.Vector3;
  occupied: boolean;
  agentId: string | null;
}

export interface Zone {
  id: ZoneId;
  label: string;
  center: THREE.Vector3;
  radius: number;
  slots: ZoneSlot[];
  markerColor: number;
}

// ── Waypoints ────────────────────────────────────────────

export interface WaypointNode {
  id: string;
  position: THREE.Vector3;
  neighbors: string[];
  zoneId?: ZoneId;
}

// ── Agent State Machine ──────────────────────────────────

export type AgentState = "spawning" | "idle" | "walking" | "working" | "thinking" | "reviewing" | "patrolling" | "celebrating" | "despawning";

export interface WorldAgent {
  id: string;
  name: string;
  role: string;
  config: RoleConfig;
  vrm: VRM | null;
  root: THREE.Object3D;
  state: AgentState;
  position: THREE.Vector3;
  targetZone: ZoneId | null;
  walkPath: THREE.Vector3[];
  walkSpeed: number;
  currentSlot: ZoneSlot | null;
  score: number;
  currentTask: string | null;
  lastActivity: number;
}

// ── World Events (from EventBridge) ──────────────────────

export type WorldEventKind =
  | "agent_spawn"
  | "agent_despawn"
  | "task_create"
  | "task_claim"
  | "task_start"
  | "task_submit"
  | "task_review"
  | "task_complete"
  | "task_rework"
  | "score_change"
  | "thinking"
  | "tool_use"
  | "idle";

export interface WorldEvent {
  kind: WorldEventKind;
  agentId: string;
  agentName?: string;
  agentRole?: string;
  targetAgentId?: string;
  detail?: string;
  value?: number;
  timestamp: number;
}

// ── Scene Constants ──────────────────────────────────────

export const WORLD = {
  // City grid
  CITY_HALF: 60,
  BLOCK_SIZE: 16,
  ROAD_WIDTH: 4,
  GROUND_Y: 0,

  // Buildings
  BUILDING_MIN_H: 2,
  BUILDING_MAX_H: 15,
  BUILDING_CORE_RADIUS: 40,

  // Legacy aliases (used by other modules)
  ISLAND_RADIUS: 60,
  ISLAND_HEIGHT: 0.1,

  SKY_RADIUS: 200,
  WALK_SPEED: 2.5,
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  SPAWN_EDGE_RADIUS: 50,
  CAMERA_DEFAULT: { x: 0, y: 55, z: 65 },
  CAMERA_LOOK_AT: { x: 0, y: 0, z: 0 },
} as const;
