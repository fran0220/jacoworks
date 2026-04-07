import * as THREE from "three";
import type { CityChunk } from "./osm-loader";

export interface BuildingChunkMesh {
  chunkId: string;
  mesh: THREE.Mesh;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function generateWindowTexture(litChance = 0.55): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 64, 128);

  const windowColors = [
    "#ffe8c0",
    "#fff5e0",
    "#ffd4a0",
    "#ffffff",
    "#e0f0ff",
  ];
  const cols = 7;
  const rows = 14;
  const ww = 4;
  const wh = 5;
  const padX = 4;
  const padY = 3;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > litChance) continue;
      ctx.fillStyle =
        windowColors[Math.floor(Math.random() * windowColors.length)];
      ctx.fillRect(padX + c * 8, padY + r * 9, ww, wh);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 创建赛博朋克建筑材质 */
export function createBuildingMaterial(): THREE.MeshStandardMaterial {
  const tex = generateWindowTexture(0.55);
  return new THREE.MeshStandardMaterial({
    color: 0x0a0f1e,
    emissive: 0xffe8c0,
    emissiveIntensity: 1.5,
    emissiveMap: tex,
    roughness: 0.7,
    metalness: 0.3,
    toneMapped: false,
  });
}

/** 为所有 chunk 创建建筑 mesh */
export function createBuildingMeshes(
  chunks: CityChunk[],
): BuildingChunkMesh[] {
  const material = createBuildingMaterial();

  return chunks.map((chunk) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(chunk.positions, 3),
    );
    geo.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
    geo.setAttribute(
      "normal",
      new THREE.BufferAttribute(chunk.normals, 3),
    );

    const mesh = new THREE.Mesh(geo, material);

    return {
      chunkId: chunk.chunkId,
      mesh,
      bounds: chunk.bounds,
    };
  });
}
