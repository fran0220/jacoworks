import * as THREE from "three";
import type { ZoneId, ZoneSlot } from "../../types";

export const ZONE_HEIGHT_Y = 0.15;

export interface ZoneDefinition {
  label: string;
  center: [number, number, number];
  radius: number;
  color: number;
}

export type SlotPattern = "semicircle" | "row" | "circle" | "scatter" | "ring";

export interface ZoneSlotConfig {
  count: number;
  pattern: SlotPattern;
  slotRadius: number;
}

export const ZONE_DEFS: Record<ZoneId, ZoneDefinition> = {
  hub: { label: "中心广场", center: [0, ZONE_HEIGHT_Y, 0], radius: 5.0, color: 0x06b6d4 },
  tower: { label: "办公园区", center: [-18, ZONE_HEIGHT_Y, -42], radius: 5.0, color: 0x3b82f6 },
  forge: { label: "科创园区", center: [-40, ZONE_HEIGHT_Y, 22], radius: 6.0, color: 0xf97316 },
  court: { label: "行政中心", center: [38, ZONE_HEIGHT_Y, -18], radius: 5.0, color: 0x22c55e },
  lounge: { label: "生态花园", center: [22, ZONE_HEIGHT_Y, 45], radius: 6.0, color: 0xe2e8f0 },
  patrol_path: { label: "环城快路", center: [0, ZONE_HEIGHT_Y, 0], radius: 48.0, color: 0xa855f7 },
};

export const ZONE_SLOT_CONFIGS: Record<ZoneId, ZoneSlotConfig> = {
  hub: { count: 4, pattern: "circle", slotRadius: 3.0 },
  tower: { count: 3, pattern: "semicircle", slotRadius: 3.5 },
  forge: { count: 5, pattern: "row", slotRadius: 4.5 },
  court: { count: 3, pattern: "semicircle", slotRadius: 3.5 },
  lounge: { count: 6, pattern: "scatter", slotRadius: 4.5 },
  patrol_path: { count: 8, pattern: "ring", slotRadius: 48.0 },
};

export function makeSlots(
  center: THREE.Vector3,
  count: number,
  pattern: SlotPattern,
  radius: number,
): ZoneSlot[] {
  const slots: ZoneSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    let x = center.x;
    let z = center.z;
    switch (pattern) {
      case "semicircle": {
        const angle = -Math.PI / 4 + (Math.PI / 2) * (i / Math.max(count - 1, 1));
        x += Math.sin(angle) * radius;
        z += Math.cos(angle) * radius;
        break;
      }
      case "row": {
        const offset = (i - (count - 1) / 2) * 0.8;
        x += offset;
        break;
      }
      case "circle": {
        const angle = (2 * Math.PI * i) / count;
        x += Math.cos(angle) * radius;
        z += Math.sin(angle) * radius;
        break;
      }
      case "scatter": {
        const angle = (2 * Math.PI * i) / count + (i % 2 === 0 ? 0.3 : -0.2);
        const ringRadius = radius * (0.5 + 0.5 * ((i % 3) / 2));
        x += Math.cos(angle) * ringRadius;
        z += Math.sin(angle) * ringRadius;
        break;
      }
      case "ring": {
        const angle = (2 * Math.PI * i) / count;
        x += Math.cos(angle) * radius;
        z += Math.sin(angle) * radius;
        break;
      }
    }
    slots.push({
      position: new THREE.Vector3(x, ZONE_HEIGHT_Y, z),
      occupied: false,
      agentId: null,
    });
  }
  return slots;
}
