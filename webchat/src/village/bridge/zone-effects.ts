import type { AgentSummary } from "../../lib/feed";
import { resolveVillageZoneForPath, type VillageZoneId } from "../VillageZone";
import type { VillageZoneEffect } from "./types";

export function buildZoneEffects(
  agentSummaries: AgentSummary[],
): Partial<Record<VillageZoneId, VillageZoneEffect>> {
  return agentSummaries.reduce<
    Partial<Record<VillageZoneId, VillageZoneEffect>>
  >((acc, summary) => {
    const reservedPaths = summary.reserved_paths ?? [];
    for (const path of reservedPaths) {
      const zoneId = resolveVillageZoneForPath(path);
      const current = acc[zoneId] ?? { reserveCount: 0, reservedPaths: [] };
      acc[zoneId] = {
        reserveCount: current.reserveCount + 1,
        reservedPaths: current.reservedPaths.includes(path)
          ? current.reservedPaths
          : [...current.reservedPaths, path].slice(0, 3),
      };
    }
    return acc;
  }, {});
}
