import type { ZoneDef } from "./types";

export const ZONE_DEFS: ZoneDef[] = [
  { pos: [0, 0], style: "plaza" },
  { pos: [-18, -42], style: "office" },
  { pos: [-40, 22], style: "tech" },
  { pos: [38, -18], style: "admin" },
  { pos: [22, 45], style: "garden" },
];

export const ZONE_COLORS: number[] = [
  0x06b6d4,
  0x3b82f6,
  0xf97316,
  0x22c55e,
  0xe2e8f0,
];

export const ROAD_CONNECTIONS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 3],
  [2, 4],
];

export const BILLBOARD_COLORS = [
  0xff6b35,
  0x00d4ff,
  0xffd700,
  0xff2d95,
  0x8b5cf6,
  0x00ff88,
];
