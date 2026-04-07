import { useMemo } from "react";
import { mapVillageStateToExpression } from "../../village/VillageAgent";
import { pickSpritePackIdFromSeed } from "../../lib/sprite-packs";
import type { SpriteExpression } from "../../lib/sprite-packs/paths";
import type { UseCitySimulationResult } from "../../city/CitySimulation";
import {
  CITY_CONTROL_ROLES,
  CITY_ZONES,
  CONTROL_ROLE_BY_ID,
  CONTROL_ROLE_FLOW,
  getZoneDefinition,
  resolveLeadRoleId,
  resolveNearestZone,
} from "./config";
import type {
  CityAgentModel,
  CityLaneSnapshot,
  CityZoneSnapshot,
} from "./types";

interface DigitalCityViewModelArgs {
  simAgents: UseCitySimulationResult["agents"];
  simHighlightedId: string | null;
  selectedAgentId: string | null;
}

export interface DigitalCityViewModel {
  displayAgents: CityAgentModel[];
  effectiveHighlightedAgentId: string | null;
  selectedAgent: CityAgentModel | null;
  selectedZone: CityZoneSnapshot["zone"];
  zoneSnapshots: CityZoneSnapshot[];
  laneSnapshots: CityLaneSnapshot[];
  selectedLane: CityLaneSnapshot | undefined;
  selectedExpression: SpriteExpression;
  selectedSpritePackId: string;
  activeStreams: number;
  flowSnapshots: CityLaneSnapshot[];
}

export function useDigitalCityViewModel({
  simAgents,
  simHighlightedId,
  selectedAgentId,
}: DigitalCityViewModelArgs): DigitalCityViewModel {
  const displayAgents = useMemo(
    () =>
      CITY_CONTROL_ROLES.map((role) => {
        const relatedNodes = simAgents.filter((agent) =>
          role.relatedZoneIds.includes(resolveNearestZone(agent.lngLat).id),
        );
        const liveNode =
          relatedNodes.find((agent) => agent.state !== "idle") ??
          relatedNodes[0] ??
          null;
        const zone = getZoneDefinition(role.primaryZoneId);
        return {
          id: `showcase-${role.id}`,
          name: role.name,
          role: role.id,
          roleLabel: role.title,
          state: liveNode?.state ?? "idle",
          statusText: liveNode?.statusText ?? role.infoFlow,
          detailText: liveNode
            ? `${role.title} 正在 ${resolveNearestZone(liveNode.lngLat).label} 接收实时信号`
            : role.mission,
          accent: role.accent,
          lngLat: zone.lngLat,
          spritePackId: pickSpritePackIdFromSeed(role.id),
        } satisfies CityAgentModel;
      }),
    [simAgents],
  );

  const effectiveHighlightedAgentId = simHighlightedId ?? selectedAgentId;
  const selectedAgent =
    displayAgents.find((agent) => agent.id === effectiveHighlightedAgentId) ??
    displayAgents[0] ??
    null;
  const selectedZone = selectedAgent
    ? resolveNearestZone(selectedAgent.lngLat)
    : CITY_ZONES[0];

  const zoneSnapshots = useMemo(
    () =>
      CITY_ZONES.map((zone) => {
        const liveNodes = simAgents.filter(
          (agent) => resolveNearestZone(agent.lngLat).id === zone.id,
        );
        return {
          zone,
          owner: CONTROL_ROLE_BY_ID[resolveLeadRoleId(zone.id)],
          nodeCount: liveNodes.length,
          activeNodeCount: liveNodes.filter((agent) => agent.state !== "idle")
            .length,
          headline:
            liveNodes.find((agent) => agent.state !== "idle")?.statusText ??
            liveNodes[0]?.statusText ??
            zone.caption,
        };
      }),
    [simAgents],
  );

  const laneSnapshots = useMemo(
    () =>
      CITY_CONTROL_ROLES.map((role) => {
        const nodes = simAgents.filter((agent) =>
          role.relatedZoneIds.includes(resolveNearestZone(agent.lngLat).id),
        );
        const activeNodes = nodes.filter((agent) => agent.state !== "idle");
        const liveNode = activeNodes[0] ?? nodes[0] ?? null;

        return {
          ...role,
          liveNode,
          liveZone: liveNode
            ? resolveNearestZone(liveNode.lngLat)
            : getZoneDefinition(role.primaryZoneId),
          nodeCount: nodes.length,
          activeNodeCount: activeNodes.length,
          signalText: liveNode?.statusText ?? role.infoFlow,
        } satisfies CityLaneSnapshot;
      }),
    [simAgents],
  );

  const selectedLaneId = resolveLeadRoleId(selectedZone.id, selectedAgent?.state);
  const selectedLane =
    laneSnapshots.find((lane) => lane.id === selectedLaneId) ?? laneSnapshots[0];
  const selectedExpression = (selectedAgent
    ? mapVillageStateToExpression(selectedAgent.state)
    : "idle") as SpriteExpression;
  const selectedSpritePackId = pickSpritePackIdFromSeed(
    selectedLane?.id ?? selectedAgent?.id ?? "city",
  );
  const activeStreams = laneSnapshots.filter(
    (lane) => lane.activeNodeCount > 0,
  ).length;
  const flowSnapshots: CityLaneSnapshot[] = CONTROL_ROLE_FLOW.reduce(
    (acc, roleId) => {
      const lane = laneSnapshots.find((item) => item.id === roleId);
      if (lane) acc.push(lane);
      return acc;
    },
    [] as CityLaneSnapshot[],
  );

  return {
    displayAgents,
    effectiveHighlightedAgentId,
    selectedAgent,
    selectedZone,
    zoneSnapshots,
    laneSnapshots,
    selectedLane,
    selectedExpression,
    selectedSpritePackId,
    activeStreams,
    flowSnapshots,
  };
}
