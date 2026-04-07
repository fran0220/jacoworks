import * as THREE from "three";
import type { Zone, ZoneId, ZoneSlot } from "../types";
import { updateZoneAnimations } from "./zones/animations";
import { ZONE_MARKER_BUILDERS, attachZoneLabel } from "./zones/builders";
import { ZONE_DEFS, ZONE_SLOT_CONFIGS, makeSlots } from "./zones/registry";

export class ZoneManager {
  private zones = new Map<ZoneId, Zone>();
  private markers = new Map<ZoneId, THREE.Group>();
  private root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.root.name = "zones";
    scene.add(this.root);

    for (const [id, definition] of Object.entries(ZONE_DEFS) as [
      ZoneId,
      (typeof ZONE_DEFS)[ZoneId],
    ][]) {
      const center = new THREE.Vector3(...definition.center);
      const slotConfig = ZONE_SLOT_CONFIGS[id];
      const zone: Zone = {
        id,
        label: definition.label,
        center,
        radius: definition.radius,
        slots: makeSlots(
          center,
          slotConfig.count,
          slotConfig.pattern,
          slotConfig.slotRadius,
        ),
        markerColor: definition.color,
      };
      this.zones.set(id, zone);

      const marker = ZONE_MARKER_BUILDERS[id]();
      marker.position.copy(center);
      marker.name = `zone_${id}`;
      attachZoneLabel(marker, id, definition.label, definition.color);

      this.root.add(marker);
      this.markers.set(id, marker);
    }
  }

  getZone(id: ZoneId): Zone {
    const zone = this.zones.get(id);
    if (!zone) throw new Error(`Unknown zone: ${id}`);
    return zone;
  }

  claimSlot(zoneId: ZoneId, agentId: string): ZoneSlot | null {
    const zone = this.getZone(zoneId);
    const available = zone.slots.find((slot) => !slot.occupied);
    if (!available) return null;
    available.occupied = true;
    available.agentId = agentId;
    return available;
  }

  releaseSlot(zoneId: ZoneId, agentId: string): void {
    const zone = this.getZone(zoneId);
    const slot = zone.slots.find((candidate) => candidate.agentId === agentId);
    if (!slot) return;
    slot.occupied = false;
    slot.agentId = null;
  }

  update(time: number) {
    updateZoneAnimations(this.markers, time);
  }
}
