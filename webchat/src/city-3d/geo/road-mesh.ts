import * as THREE from "three";
import type { CityRoad } from "./osm-loader";

const ROAD_Y = 0.02;
const EDGE_WIDTH = 0.1;

function createRoadMaterial(
  isPrimary: boolean,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: isPrimary ? 0x1a1a2e : 0x0f0f1e,
    emissive: 0xff6b35,
    emissiveIntensity: isPrimary ? 0.3 : 0.2,
    transparent: true,
    opacity: isPrimary ? 0.5 : 0.3,
    depthWrite: false,
    toneMapped: false,
  });
}

function createEdgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    toneMapped: false,
  });
}

function buildRibbonGeometry(
  points: Float32Array,
  halfWidth: number,
  y: number,
): THREE.BufferGeometry | null {
  const vertCount = points.length / 2;
  if (vertCount < 2) return null;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < vertCount; i++) {
    const x = points[i * 2];
    const z = points[i * 2 + 1];

    let dx: number;
    let dz: number;
    if (i === 0) {
      dx = points[2] - points[0];
      dz = points[3] - points[1];
    } else if (i === vertCount - 1) {
      dx = points[i * 2] - points[(i - 1) * 2];
      dz = points[i * 2 + 1] - points[(i - 1) * 2 + 1];
    } else {
      dx = points[(i + 1) * 2] - points[(i - 1) * 2];
      dz = points[(i + 1) * 2 + 1] - points[(i - 1) * 2 + 1];
    }

    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) {
      positions.push(x, y, z, x, y, z);
      if (i < vertCount - 1) {
        const vi = i * 2;
        indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      }
      continue;
    }

    const nx = -dz / len;
    const nz = dx / len;

    positions.push(x + nx * halfWidth, y, z + nz * halfWidth);
    positions.push(x - nx * halfWidth, y, z - nz * halfWidth);

    if (i < vertCount - 1) {
      const vi = i * 2;
      indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 创建所有道路的 Mesh */
export function createRoadMeshes(
  roads: CityRoad[],
  scene: THREE.Scene,
): void {
  const primaryMat = createRoadMaterial(true);
  const secondaryMat = createRoadMaterial(false);
  const edgeMat = createEdgeMaterial();

  for (const road of roads) {
    const isPrimary =
      road.type === "primary" ||
      road.type === "trunk" ||
      road.type === "motorway";
    const halfWidth = road.width / 2;

    const ribbonGeo = buildRibbonGeometry(road.points, halfWidth, ROAD_Y);
    if (!ribbonGeo) continue;

    const ribbonMesh = new THREE.Mesh(
      ribbonGeo,
      isPrimary ? primaryMat : secondaryMat,
    );
    scene.add(ribbonMesh);

    const leftGeo = buildRibbonGeometry(
      road.points,
      halfWidth + EDGE_WIDTH,
      ROAD_Y + 0.001,
    );
    const rightGeo = buildRibbonGeometry(
      road.points,
      halfWidth,
      ROAD_Y + 0.001,
    );
    if (leftGeo && rightGeo) {
      const leftEdge = buildRibbonGeometry(
        road.points,
        halfWidth + EDGE_WIDTH,
        ROAD_Y + 0.005,
      );
      const rightEdge = buildRibbonGeometry(
        road.points,
        halfWidth + EDGE_WIDTH * 2,
        ROAD_Y + 0.005,
      );
      if (leftEdge) {
        const edgeMesh = new THREE.Mesh(leftEdge, edgeMat);
        scene.add(edgeMesh);
      }
      rightGeo.dispose();
      if (rightEdge) rightEdge.dispose();
    }
  }
}
