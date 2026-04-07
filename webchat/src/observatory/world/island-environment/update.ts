import * as THREE from "three";
import { WORLD } from "../../types";
import type {
  ParticleData,
  RoadEndpoint,
  RoadParticle,
  TwinkleStar,
} from "./types";

export function updateShaderMaterials(
  time: number,
  shaderMaterials: THREE.ShaderMaterial[],
) {
  for (const mat of shaderMaterials) {
    if (mat.uniforms.uTime) mat.uniforms.uTime.value = time;
  }
}

export function updateStarfield(
  time: number,
  starGeometry: THREE.BufferGeometry,
  starData: TwinkleStar[],
) {
  const sizeAttr = starGeometry.getAttribute("size") as THREE.BufferAttribute;
  for (let i = 0; i < starData.length; i += 1) {
    const s = starData[i];
    sizeAttr.array[i] = s.baseSize * (0.6 + 0.4 * Math.sin(time * s.speed + s.phase));
  }
  sizeAttr.needsUpdate = true;
}

export function updateAtmosphericParticles(
  time: number,
  particleGeometry: THREE.BufferGeometry,
  particleData: ParticleData[],
) {
  const posAttr = particleGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < particleData.length; i += 1) {
    const p = particleData[i];
    const drift = (time * p.speed * 0.3) % 30;
    posAttr.array[i * 3 + 1] = p.baseY + drift + Math.sin(time * p.speed + p.phase) * 0.5;
    if (posAttr.array[i * 3 + 1] > 30) {
      posAttr.array[i * 3 + 1] = 0.5;
      p.baseY = 0.5 + Math.random() * 2;
    }
  }
  posAttr.needsUpdate = true;
}

export function updateRoadFlowParticles(
  roadParticleGeo: THREE.BufferGeometry,
  roadParticles: RoadParticle[],
  roadEndpoints: RoadEndpoint[],
) {
  if (!roadParticleGeo || roadParticles.length === 0) return;

  const rpAttr = roadParticleGeo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < roadParticles.length; i += 1) {
    const rp = roadParticles[i];
    rp.progress += rp.speed * 0.016;
    if (rp.progress > 1) rp.progress -= 1;

    const ep = roadEndpoints[rp.roadIdx];
    rpAttr.array[i * 3] = ep.ax + (ep.bx - ep.ax) * rp.progress;
    rpAttr.array[i * 3 + 1] = WORLD.GROUND_Y + 0.2 + Math.sin(rp.progress * Math.PI) * 0.3;
    rpAttr.array[i * 3 + 2] = ep.az + (ep.bz - ep.az) * rp.progress;
  }
  rpAttr.needsUpdate = true;
}

export function updateBillboards(billboards: THREE.Mesh[]) {
  for (const bb of billboards) {
    bb.rotation.y += 0.002;
  }
}
