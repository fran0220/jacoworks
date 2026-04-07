import * as THREE from "three";
import type { CityZoneId } from "./zone-mapping";
import { getZone3D } from "./zone-mapping";

const Y = 0.15;

// ── Types ────────────────────────────────────────────────

export interface CityWaypoint {
  id: string;
  position: THREE.Vector3;
  neighbors: string[];
  zoneId?: CityZoneId;
}

interface WaypointDef {
  id: string;
  pos: [number, number, number];
  neighbors: string[];
  zoneId?: CityZoneId;
}

// ── Waypoint definitions ─────────────────────────────────
// Hub-and-spoke with shortcuts between adjacent zones + patrol ring.

const WAYPOINT_DEFS: WaypointDef[] = [
  // ── Zone center nodes ──────────────────────────────────
  { id: "city_hall",         pos: [0,    Y, 0],    neighbors: ["hub_innovation", "hub_data", "hub_eco", "hub_logistics", "hub_robotics", "hub_tongming", "hub_esports_1"], zoneId: "city_hall" },
  { id: "innovation_center", pos: [30,   Y, -55],  neighbors: ["hub_innovation", "shortcut_innov_robo"],                     zoneId: "innovation_center" },
  { id: "data_hub",          pos: [107,  Y, 55],   neighbors: ["hub_data", "shortcut_data_logi"],                            zoneId: "data_hub" },
  { id: "esports_center",    pos: [436,  Y, 300],  neighbors: ["hub_esports_2", "shortcut_logi_esports"],                    zoneId: "esports_center" },
  { id: "robotics_park",     pos: [192,  Y, -66],  neighbors: ["hub_robotics", "shortcut_innov_robo"],                       zoneId: "robotics_park" },
  { id: "tongming_lake",     pos: [-107, Y, -100], neighbors: ["hub_tongming", "shortcut_eco_tongming"],                     zoneId: "tongming_lake" },
  { id: "logistics_port",    pos: [276,  Y, 144],  neighbors: ["hub_logistics", "shortcut_data_logi", "shortcut_logi_esports"], zoneId: "logistics_port" },
  { id: "eco_garden",        pos: [-46,  Y, 111],  neighbors: ["hub_eco", "shortcut_eco_tongming"],                          zoneId: "eco_garden" },

  // ── Hub → zone intermediate nodes ──────────────────────
  { id: "hub_innovation",  pos: [15,  Y, -28],  neighbors: ["city_hall", "innovation_center"] },
  { id: "hub_data",        pos: [54,  Y, 28],   neighbors: ["city_hall", "data_hub"] },
  { id: "hub_esports_1",   pos: [145, Y, 100],  neighbors: ["city_hall", "hub_esports_2"] },
  { id: "hub_esports_2",   pos: [290, Y, 200],  neighbors: ["hub_esports_1", "esports_center"] },
  { id: "hub_robotics",    pos: [96,  Y, -33],  neighbors: ["city_hall", "robotics_park"] },
  { id: "hub_tongming",    pos: [-54, Y, -50],  neighbors: ["city_hall", "tongming_lake"] },
  { id: "hub_logistics",   pos: [138, Y, 72],   neighbors: ["city_hall", "logistics_port"] },
  { id: "hub_eco",         pos: [-23, Y, 56],   neighbors: ["city_hall", "eco_garden"] },

  // ── Shortcut intermediates (adjacent zone connections) ─
  { id: "shortcut_innov_robo",   pos: [111, Y, -60],  neighbors: ["innovation_center", "robotics_park"] },
  { id: "shortcut_data_logi",    pos: [192, Y, 100],  neighbors: ["data_hub", "logistics_port"] },
  { id: "shortcut_logi_esports", pos: [356, Y, 222],  neighbors: ["logistics_port", "esports_center"] },
  { id: "shortcut_eco_tongming", pos: [-77, Y, 5],    neighbors: ["eco_garden", "tongming_lake"] },

  // ── Patrol ring (12 nodes around radius ~350) ──────────
  ...Array.from({ length: 12 }, (_, i) => {
    const angle = (2 * Math.PI * i) / 12;
    const id = `patrol_${i}`;
    const prev = `patrol_${(i + 11) % 12}`;
    const next = `patrol_${(i + 1) % 12}`;
    return {
      id,
      pos: [
        Math.round(Math.cos(angle) * 350),
        Y,
        Math.round(Math.sin(angle) * 350),
      ] as [number, number, number],
      neighbors: [prev, next],
    };
  }),
];

// Connect patrol ring to the road network via hub_esports_1 (the most outward hub node)
WAYPOINT_DEFS.find((w) => w.id === "hub_esports_1")!.neighbors.push("patrol_0");
WAYPOINT_DEFS.find((w) => w.id === "patrol_0")!.neighbors.push("hub_esports_1");

// Also connect patrol_9 (near tongming_lake quadrant) to hub_tongming
WAYPOINT_DEFS.find((w) => w.id === "hub_tongming")!.neighbors.push("patrol_9");
WAYPOINT_DEFS.find((w) => w.id === "patrol_9")!.neighbors.push("hub_tongming");

// ── A* implementation ────────────────────────────────────

function heuristic(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.distanceTo(b);
}

function reconstructPath(
  cameFrom: Map<string, string>,
  current: string,
  nodes: Map<string, CityWaypoint>,
): THREE.Vector3[] {
  const path: THREE.Vector3[] = [nodes.get(current)!.position.clone()];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(nodes.get(current)!.position.clone());
  }
  return path;
}

function astar(
  nodes: Map<string, CityWaypoint>,
  startId: string,
  goalId: string,
): THREE.Vector3[] {
  if (startId === goalId) return [nodes.get(startId)!.position.clone()];

  const openSet = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startId, 0);
  fScore.set(startId, heuristic(nodes.get(startId)!.position, nodes.get(goalId)!.position));

  while (openSet.size > 0) {
    let current = "";
    let best = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < best) { best = f; current = id; }
    }
    if (current === goalId) return reconstructPath(cameFrom, current, nodes);

    openSet.delete(current);
    const node = nodes.get(current)!;

    for (const neighborId of node.neighbors) {
      const neighbor = nodes.get(neighborId);
      if (!neighbor) continue;
      const tentativeG = (gScore.get(current) ?? Infinity) + node.position.distanceTo(neighbor.position);
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, current);
        gScore.set(neighborId, tentativeG);
        fScore.set(neighborId, tentativeG + heuristic(neighbor.position, nodes.get(goalId)!.position));
        openSet.add(neighborId);
      }
    }
  }

  // No path found — fallback direct line
  return [nodes.get(startId)!.position.clone(), nodes.get(goalId)!.position.clone()];
}

// ── CityWaypointGraph ────────────────────────────────────

export class CityWaypointGraph {
  private nodes = new Map<string, CityWaypoint>();

  constructor() {
    for (const def of WAYPOINT_DEFS) {
      this.nodes.set(def.id, {
        id: def.id,
        position: new THREE.Vector3(...def.pos),
        neighbors: [...def.neighbors],
        zoneId: def.zoneId,
      });
    }
  }

  findNearestWaypoint(position: THREE.Vector3): CityWaypoint {
    let best: CityWaypoint | null = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = position.distanceTo(node.position);
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best!;
  }

  findPath(from: THREE.Vector3, toZoneId: CityZoneId): THREE.Vector3[] {
    const startNode = this.findNearestWaypoint(from);
    const goalId = toZoneId; // zone center node id === zoneId
    const path = astar(this.nodes, startNode.id, goalId);

    if (path.length > 0 && from.distanceTo(path[0]) > 0.5) {
      path.unshift(from.clone());
    }

    // Append the actual zone center (from zone-mapping) for precision
    const zoneCenter = getZone3D(toZoneId).center;
    if (path.length > 0 && path[path.length - 1].distanceTo(zoneCenter) > 0.5) {
      path.push(zoneCenter.clone());
    }

    return path;
  }

  getPatrolPath(fromPosition: THREE.Vector3): THREE.Vector3[] {
    const startNode = this.findNearestWaypoint(fromPosition);

    // Find nearest patrol node
    let nearestPatrol = "patrol_0";
    let nearestDist = Infinity;
    for (const node of this.nodes.values()) {
      if (!node.id.startsWith("patrol_")) continue;
      const d = fromPosition.distanceTo(node.position);
      if (d < nearestDist) { nearestDist = d; nearestPatrol = node.id; }
    }

    // Path from current position to nearest patrol node
    const toPatrol = astar(this.nodes, startNode.id, nearestPatrol);

    // Build full ring from that patrol node
    const patrolIdx = parseInt(nearestPatrol.split("_")[1], 10);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = (patrolIdx + i) % 12;
      const node = this.nodes.get(`patrol_${idx}`)!;
      ring.push(node.position.clone());
    }
    // Close the loop
    ring.push(this.nodes.get(`patrol_${patrolIdx}`)!.position.clone());

    // Combine: approach path (skip last if it equals ring start) + ring
    const combined = [...toPatrol];
    if (combined.length > 0 && ring.length > 0 && combined[combined.length - 1].distanceTo(ring[0]) < 0.5) {
      combined.pop();
    }
    combined.push(...ring);

    if (combined.length > 0 && fromPosition.distanceTo(combined[0]) > 0.5) {
      combined.unshift(fromPosition.clone());
    }

    return combined;
  }

  getNodes(): CityWaypoint[] {
    return Array.from(this.nodes.values());
  }
}
