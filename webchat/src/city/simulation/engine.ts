import { pickSpritePackIdFromSeed } from "../../lib/sprite-packs";
import {
  CITY_MOVE_DURATION_MS,
  inferCityFacing,
  interpolateCityPoint,
} from "../CityAgent";
import {
  CITY_ZONES,
  getCitySlot,
  type CityZoneId,
} from "../CityZone";
import {
  ARRIVAL_STATES,
  CITIZEN_TYPES,
  CITY_CITIZENS,
} from "./data";
import type {
  CityCitizen,
  CitizenType,
  SimAgent,
  SimulationAgentOutput,
} from "./types";

interface TickResult {
  lastStory: string;
  highlightedAgentId: string | null;
  activeCount: number;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const ALL_ZONE_IDS = Object.keys(CITY_ZONES) as CityZoneId[];

function pickTargetZone(citizen: CityCitizen): CityZoneId {
  const info = CITIZEN_TYPES[citizen.type];
  if (Math.random() < 0.7) {
    return pickRandom(info.homeZones);
  }
  return pickRandom(ALL_ZONE_IDS);
}

function pickBehavior(citizen: CityCitizen): string {
  return pickRandom(CITIZEN_TYPES[citizen.type].behaviors);
}

function pickArrivalState(citizenType: CitizenType) {
  return pickRandom(ARRIVAL_STATES[citizenType]);
}

export function allocateSlot(
  zoneId: CityZoneId,
  occupied: Map<CityZoneId, Set<number>>,
): number {
  const zone = CITY_ZONES[zoneId];
  const used = occupied.get(zoneId) ?? new Set();
  for (let i = 0; i < zone.slots.length; i += 1) {
    if (!used.has(i)) {
      used.add(i);
      occupied.set(zoneId, used);
      return i;
    }
  }
  const idx = used.size % zone.slots.length;
  used.add(idx);
  occupied.set(zoneId, used);
  return idx;
}

export function releaseSlot(
  zoneId: CityZoneId,
  slotIndex: number,
  occupied: Map<CityZoneId, Set<number>>,
): void {
  const used = occupied.get(zoneId);
  if (used) used.delete(slotIndex);
}

export function initializeAgents(occupied: Map<CityZoneId, Set<number>>): SimAgent[] {
  const now = performance.now();
  return CITY_CITIZENS.map((citizen) => {
    const zoneId = citizen.homeZoneId;
    const slotIndex = allocateSlot(zoneId, occupied);
    const position = getCitySlot(zoneId, slotIndex);
    return {
      citizen,
      zoneId,
      slotIndex,
      state: "idle",
      statusText: `在${CITY_ZONES[zoneId].label}休息`,
      position,
      facing: "down",
      dwellUntil: now + randomInt(2000, 8000),
      moving: false,
      moveFrom: null,
      moveTo: null,
      moveStartedAt: 0,
    };
  });
}

export function toSimulationOutput(agent: SimAgent): SimulationAgentOutput {
  return {
    id: agent.citizen.id,
    name: agent.citizen.name,
    role: agent.citizen.type,
    roleLabel: agent.citizen.typeLabel,
    state: agent.state,
    statusText: agent.statusText,
    detailText: agent.citizen.description,
    accent: agent.citizen.accent,
    lngLat: [agent.position.lng, agent.position.lat],
    facing: agent.facing,
    spritePackId: pickSpritePackIdFromSeed(agent.citizen.id),
  };
}

export function animateAgents(agents: SimAgent[], now: number): boolean {
  let anyMoving = false;

  for (const agent of agents) {
    if (!agent.moving || !agent.moveFrom || !agent.moveTo) continue;
    const elapsed = now - agent.moveStartedAt;
    const rawProgress = Math.min(1, elapsed / CITY_MOVE_DURATION_MS);
    const progress =
      rawProgress < 0.5
        ? 4 * rawProgress * rawProgress * rawProgress
        : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;

    if (rawProgress >= 1) {
      agent.position = { ...agent.moveTo };
      agent.moving = false;
      agent.moveFrom = null;
      agent.moveTo = null;
      agent.state = pickArrivalState(agent.citizen.type);
      agent.statusText = pickBehavior(agent.citizen);
      agent.dwellUntil = now + randomInt(8000, 15000);
      continue;
    }

    agent.position = interpolateCityPoint(agent.moveFrom, agent.moveTo, progress);
    anyMoving = true;
  }

  return anyMoving;
}

export function runSimulationTick(
  agents: SimAgent[],
  occupied: Map<CityZoneId, Set<number>>,
  now: number,
): TickResult {
  const eligible = agents.filter((agent) => !agent.moving && now >= agent.dwellUntil);
  const robotsReady = agents.filter(
    (agent) => agent.citizen.type === "robot" && !agent.moving && now >= agent.dwellUntil - 2000,
  );
  const candidates = [...new Set([...eligible, ...robotsReady])];
  const count = Math.min(candidates.length, randomInt(2, 4));
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  let lastStory = "";

  for (const agent of selected) {
    const targetZoneId = pickTargetZone(agent.citizen);
    if (targetZoneId === agent.zoneId && agent.state !== "idle") {
      agent.state = pickArrivalState(agent.citizen.type);
      agent.statusText = pickBehavior(agent.citizen);
      agent.dwellUntil = now + randomInt(8000, 15000);
      lastStory = `${agent.citizen.name}${agent.statusText}`;
      continue;
    }

    releaseSlot(agent.zoneId, agent.slotIndex, occupied);
    const newSlotIndex = allocateSlot(targetZoneId, occupied);
    const targetPos = getCitySlot(targetZoneId, newSlotIndex);

    agent.moveFrom = { ...agent.position };
    agent.moveTo = targetPos;
    agent.moveStartedAt = now;
    agent.moving = true;
    agent.state = "walking";
    agent.statusText = `前往${CITY_ZONES[targetZoneId].label}`;
    agent.facing = inferCityFacing(agent.position, targetPos);
    agent.zoneId = targetZoneId;
    agent.slotIndex = newSlotIndex;
    lastStory = `${agent.citizen.name}正在前往${CITY_ZONES[targetZoneId].label}`;
  }

  const highlightedAgentId = selected.length > 0 ? selected[selected.length - 1]!.citizen.id : null;
  const activeCount = agents.filter((agent) => agent.state !== "idle").length;

  for (const agent of agents) {
    if (agent.moving) continue;
    if (now < agent.dwellUntil) continue;
    if (agent.state !== "celebrating") continue;

    const homeZone = agent.citizen.homeZoneId;
    if (agent.zoneId !== homeZone) {
      releaseSlot(agent.zoneId, agent.slotIndex, occupied);
      const slot = allocateSlot(homeZone, occupied);
      const pos = getCitySlot(homeZone, slot);
      agent.moveFrom = { ...agent.position };
      agent.moveTo = pos;
      agent.moveStartedAt = now;
      agent.moving = true;
      agent.state = "walking";
      agent.statusText = `返回${CITY_ZONES[homeZone].label}`;
      agent.facing = inferCityFacing(agent.position, pos);
      agent.zoneId = homeZone;
      agent.slotIndex = slot;
      continue;
    }

    agent.state = "idle";
    agent.statusText = `在${CITY_ZONES[agent.zoneId].label}休息`;
    agent.dwellUntil = now + randomInt(5000, 12000);
  }

  return { lastStory, highlightedAgentId, activeCount };
}
