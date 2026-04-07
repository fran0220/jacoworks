import { VILLAGE_ZONES, type VillagePoint, type VillageZoneId } from "./VillageZone";

export type { VillagePoint };

// ── Waypoint graph ──────────────────────────────────────────────────

export interface WaypointNode {
  id: string;
  position: VillagePoint;
  neighbors: string[];
  zoneId?: string;
}

const wp = (
  id: string,
  x: number,
  y: number,
  neighbors: string[],
  zoneId?: string,
): WaypointNode => ({ id, position: { x, y }, neighbors, zoneId });

/**
 * ~25 waypoints laid out along the dirt paths of the island village.
 *
 * West side:   library ↔ crops ↔ docks (via w1–w4)
 * Central:     library → w5 → w6 → plaza → w9 → hq → market → watchtower
 * South:       plaza → w10 → campfire
 * South-west:  docks → w11 → campfire
 */
const WAYPOINTS: WaypointNode[] = [
  // ── Zone anchors ──
  wp("library",    22.8, 24.8, ["w1", "w5"],              "library"),
  wp("crops",      16.9, 34.8, ["w1", "w2"],              "crops"),
  wp("docks",      24.7, 83.7, ["w4", "w11"],             "docks"),
  wp("plaza",      56.1, 52.4, ["w7", "w9", "w10", "w8"], "plaza"),
  wp("hq",         66.4, 38.8, ["w9", "w12"],             "hq"),
  wp("market",     72.4, 31.6, ["w12", "w13"],             "market"),
  wp("watchtower", 80.6, 23.1, ["w13"],                   "watchtower"),
  wp("campfire",   58.1, 73.6, ["w10", "w11"],            "campfire"),

  // ── West path: library ↔ crops ↔ docks ──
  wp("w1", 19.5, 30.0, ["library", "crops"]),          // fork between library & crops
  wp("w2", 16.0, 48.0, ["crops", "w3"]),               // south of crops
  wp("w3", 18.5, 64.0, ["w2", "w4"]),                  // mid-west coast
  wp("w4", 22.0, 76.0, ["w3", "docks"]),               // approach to docks

  // ── Central path: library → plaza ──
  wp("w5", 32.0, 28.0, ["library", "w6"]),             // east of library
  wp("w6", 40.0, 35.0, ["w5", "w7"]),                  // midway bend
  wp("w7", 48.0, 44.0, ["w6", "plaza"]),               // approach plaza from west

  // ── East connector: plaza → hq path ──
  wp("w8", 60.0, 48.0, ["plaza", "w9"]),               // east of plaza
  wp("w9", 64.0, 42.0, ["w8", "hq"]),                  // approach HQ

  // ── South path: plaza ↔ campfire ──
  wp("w10", 56.5, 63.0, ["plaza", "campfire"]),         // midway to campfire

  // ── South-west coast: docks ↔ campfire ──
  wp("w11", 40.0, 80.0, ["docks", "campfire"]),         // coastal path

  // ── East side: hq → market → watchtower ──
  wp("w12", 70.0, 34.5, ["hq", "market"]),              // between hq & market
  wp("w13", 77.0, 27.0, ["market", "watchtower"]),      // approach watchtower

  // ── Cross path: west path → plaza (shortcut via crops area) ──
  wp("w14", 28.0, 42.0, ["w2", "w6"]),                  // shortcut node
];

// Build adjacency lookup (bidirectional)
const nodeMap = new Map<string, WaypointNode>();
for (const node of WAYPOINTS) {
  nodeMap.set(node.id, node);
}
// Ensure bidirectionality
for (const node of WAYPOINTS) {
  for (const nid of node.neighbors) {
    const neighbor = nodeMap.get(nid);
    if (neighbor && !neighbor.neighbors.includes(node.id)) {
      neighbor.neighbors.push(node.id);
    }
  }
}

export const WAYPOINT_GRAPH: ReadonlyMap<string, WaypointNode> = nodeMap;

// ── Helpers ─────────────────────────────────────────────────────────

function dist(a: VillagePoint, b: VillagePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── findNearestWaypoint ─────────────────────────────────────────────

export function findNearestWaypoint(point: VillagePoint): WaypointNode {
  let best: WaypointNode | undefined;
  let bestDist = Infinity;
  for (const node of nodeMap.values()) {
    const d = dist(point, node.position);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best!;
}

// ── A* pathfinding ──────────────────────────────────────────────────

function reconstructPath(
  cameFrom: Map<string, string>,
  current: string,
): string[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(current);
  }
  return path;
}

function astar(startId: string, goalId: string): string[] {
  const start = nodeMap.get(startId);
  const goal = nodeMap.get(goalId);
  if (!start || !goal) return [];

  const openSet = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startId, 0);
  fScore.set(startId, dist(start.position, goal.position));

  while (openSet.size > 0) {
    // Pick node in openSet with lowest fScore
    let current = "";
    let currentF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < currentF) {
        currentF = f;
        current = id;
      }
    }

    if (current === goalId) {
      return reconstructPath(cameFrom, current);
    }

    openSet.delete(current);
    const currentNode = nodeMap.get(current)!;
    const currentG = gScore.get(current) ?? Infinity;

    for (const neighborId of currentNode.neighbors) {
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) continue;

      const tentativeG = currentG + dist(currentNode.position, neighbor.position);
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, current);
        gScore.set(neighborId, tentativeG);
        fScore.set(neighborId, tentativeG + dist(neighbor.position, goal.position));
        openSet.add(neighborId);
      }
    }
  }

  return []; // no path found
}

// ── findPath ────────────────────────────────────────────────────────

/**
 * Find a path of VillagePoints from one zone to another using A*.
 * Returns an empty array if source and destination are the same zone.
 */
export function findPath(
  fromZoneId: VillageZoneId,
  toZoneId: VillageZoneId,
): VillagePoint[] {
  if (fromZoneId === toZoneId) return [];

  // Find waypoints closest to zone anchors
  const fromAnchor = VILLAGE_ZONES[fromZoneId].anchor;
  const toAnchor = VILLAGE_ZONES[toZoneId].anchor;
  const startNode = findNearestWaypoint(fromAnchor);
  const goalNode = findNearestWaypoint(toAnchor);

  const nodeIds = astar(startNode.id, goalNode.id);
  if (nodeIds.length === 0) return [];

  return nodeIds.map((id) => nodeMap.get(id)!.position);
}

// ── interpolatePath ─────────────────────────────────────────────────

/**
 * Given a path and progress (0→1), return the interpolated position
 * along the polyline using linear segment interpolation.
 */
export function interpolatePath(
  path: VillagePoint[],
  progress: number,
): VillagePoint {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1 || progress <= 0) return path[0];
  if (progress >= 1) return path[path.length - 1];

  // Compute cumulative segment lengths
  const segLengths: number[] = [];
  let totalLength = 0;
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i]);
    segLengths.push(d);
    totalLength += d;
  }

  if (totalLength === 0) return path[0];

  const targetDist = progress * totalLength;
  let accumulated = 0;

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accumulated + segLen >= targetDist) {
      const segProgress = (targetDist - accumulated) / segLen;
      const a = path[i];
      const b = path[i + 1];
      return {
        x: a.x + (b.x - a.x) * segProgress,
        y: a.y + (b.y - a.y) * segProgress,
      };
    }
    accumulated += segLen;
  }

  return path[path.length - 1];
}

// ── getPathDuration ─────────────────────────────────────────────────

/** Map-% per millisecond. 3% per second = 0.003 per ms. */
const SPEED = 0.003;

/**
 * Returns duration in ms for traversing the given path.
 * Base speed: ~3% of map per second.
 */
export function getPathDuration(path: VillagePoint[]): number {
  if (path.length < 2) return 0;
  let totalDist = 0;
  for (let i = 1; i < path.length; i++) {
    totalDist += dist(path[i - 1], path[i]);
  }
  return totalDist / SPEED;
}
