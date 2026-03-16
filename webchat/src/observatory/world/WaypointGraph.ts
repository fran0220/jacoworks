import * as THREE from "three";
import type { WaypointNode, ZoneId } from "../types";

const Y = 0.15;

// ── Waypoint definitions ────────────────────────────────
// Star topology: hub connects to all zones.
// Shortcuts: tower↔court, forge↔lounge.

interface WaypointDef {
  id: string;
  pos: [number, number, number];
  neighbors: string[];
  zoneId?: ZoneId;
}

const WAYPOINT_DEFS: WaypointDef[] = [
  // Zone centers
  { id: "hub",    pos: [0, Y, 0],      neighbors: ["hub_tower", "hub_forge", "hub_court", "hub_lounge"], zoneId: "hub" },
  { id: "tower",  pos: [-18, Y, -42],  neighbors: ["hub_tower", "tower_court"],                          zoneId: "tower" },
  { id: "forge",  pos: [-40, Y, 22],   neighbors: ["hub_forge", "forge_lounge"],                         zoneId: "forge" },
  { id: "court",  pos: [38, Y, -18],   neighbors: ["hub_court", "tower_court"],                          zoneId: "court" },
  { id: "lounge", pos: [22, Y, 45],    neighbors: ["hub_lounge", "forge_lounge"],                        zoneId: "lounge" },

  // Intermediate points along hub→zone paths
  { id: "hub_tower",  pos: [-9, Y, -21],   neighbors: ["hub", "tower"] },
  { id: "hub_forge",  pos: [-20, Y, 11],   neighbors: ["hub", "forge"] },
  { id: "hub_court",  pos: [19, Y, -9],    neighbors: ["hub", "court"] },
  { id: "hub_lounge", pos: [11, Y, 22],    neighbors: ["hub", "lounge"] },

  // Shortcut intermediates
  { id: "tower_court",  pos: [10, Y, -30],  neighbors: ["tower", "court"] },
  { id: "forge_lounge", pos: [-9, Y, 34],   neighbors: ["forge", "lounge"] },

  // Patrol ring waypoints (8 evenly around radius 48)
  ...Array.from({ length: 8 }, (_, i) => {
    const angle = (2 * Math.PI * i) / 8;
    const id = `patrol_${i}`;
    const prev = `patrol_${(i + 7) % 8}`;
    const next = `patrol_${(i + 1) % 8}`;
    return {
      id,
      pos: [Math.cos(angle) * 48, Y, Math.sin(angle) * 48] as [number, number, number],
      neighbors: [prev, next],
      zoneId: "patrol_path" as ZoneId,
    };
  }),
];

// Connect hub to the nearest patrol node for reachability
WAYPOINT_DEFS.find((w) => w.id === "hub")!.neighbors.push("patrol_0");
WAYPOINT_DEFS.find((w) => w.id === "patrol_0")!.neighbors.push("hub");

// ── A* implementation ───────────────────────────────────

function heuristic(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.distanceTo(b);
}

function reconstructPath(cameFrom: Map<string, string>, current: string, nodes: Map<string, WaypointNode>): THREE.Vector3[] {
  const path: THREE.Vector3[] = [nodes.get(current)!.position];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(nodes.get(current)!.position);
  }
  return path;
}

function astar(nodes: Map<string, WaypointNode>, startId: string, goalId: string): THREE.Vector3[] {
  if (startId === goalId) return [nodes.get(startId)!.position];

  const openSet = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startId, 0);
  fScore.set(startId, heuristic(nodes.get(startId)!.position, nodes.get(goalId)!.position));

  while (openSet.size > 0) {
    // pick node with lowest fScore
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

  // no path found — fallback direct
  return [nodes.get(startId)!.position, nodes.get(goalId)!.position];
}

// ── WaypointGraph ───────────────────────────────────────

export class WaypointGraph {
  private nodes = new Map<string, WaypointNode>();
  private zoneNodeIds = new Map<ZoneId, string[]>();

  constructor() {
    // Build nodes
    for (const def of WAYPOINT_DEFS) {
      this.nodes.set(def.id, {
        id: def.id,
        position: new THREE.Vector3(...def.pos),
        neighbors: [...def.neighbors],
        zoneId: def.zoneId,
      });
      if (def.zoneId) {
        const arr = this.zoneNodeIds.get(def.zoneId) ?? [];
        arr.push(def.id);
        this.zoneNodeIds.set(def.zoneId, arr);
      }
    }
  }

  /** Find the nearest waypoint to a world position. */
  findNearestWaypoint(position: THREE.Vector3): WaypointNode {
    let best: WaypointNode | null = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = position.distanceTo(node.position);
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best!;
  }

  /**
   * A* path from a world position to the center of a target zone.
   * Returns ordered array of positions to walk through.
   */
  findPath(from: THREE.Vector3, toZoneId: ZoneId): THREE.Vector3[] {
    const startNode = this.findNearestWaypoint(from);

    // For patrol_path, pick nearest patrol node as goal
    // For other zones, use the zone-center node directly
    let goalId: string;
    if (toZoneId === "patrol_path") {
      const patrolNodes = this.zoneNodeIds.get("patrol_path") ?? [];
      let best = patrolNodes[0] ?? "hub";
      let bestDist = Infinity;
      for (const pid of patrolNodes) {
        const d = from.distanceTo(this.nodes.get(pid)!.position);
        if (d < bestDist) { bestDist = d; best = pid; }
      }
      goalId = best;
    } else {
      goalId = toZoneId; // zone center node has id === zoneId
    }

    const path = astar(this.nodes, startNode.id, goalId);

    // If starting position is far from first waypoint, prepend it
    if (path.length > 0 && from.distanceTo(path[0]) > 0.5) {
      path.unshift(from.clone());
    }

    return path;
  }

  /** Get all waypoint nodes (for debug visualization). */
  getNodes(): WaypointNode[] {
    return Array.from(this.nodes.values());
  }
}
