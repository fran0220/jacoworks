import * as THREE from "three";
import type { ZoneId } from "../../types";

export function updateZoneAnimations(
  markers: Map<ZoneId, THREE.Group>,
  time: number,
) {
  const hub = markers.get("hub");
  const hubRing = hub?.getObjectByName("hub_ring");
  if (hubRing) hubRing.rotation.z = time * 0.3;
  const hubRing2 = hub?.getObjectByName("hub_ring_2");
  if (hubRing2) {
    hubRing2.rotation.z = -time * 0.4;
    hubRing2.rotation.y = time * 0.2;
  }
  const hubRing3 = hub?.getObjectByName("hub_ring_3");
  if (hubRing3) {
    hubRing3.rotation.z = time * 0.15;
    hubRing3.rotation.y = -time * 0.3;
  }

  const hubSatellites = hub?.getObjectByName("hub_satellites");
  if (hubSatellites) {
    hubSatellites.children.forEach((child, index) => {
      child.position.x = Math.cos(time * 0.5 + (index * Math.PI) / 2) * 1.8;
      child.position.z = Math.sin(time * 0.5 + (index * Math.PI) / 2) * 1.8;
    });
  }

  const tower = markers.get("tower");
  const towerCrystal = tower?.getObjectByName("tower_crystal");
  if (towerCrystal) {
    towerCrystal.position.y = 4.0 + Math.sin(time * 1.5) * 0.12;
    towerCrystal.rotation.y = time * 0.5;
  }
  const holographicDisc = tower?.getObjectByName("tower_holo_disc");
  if (holographicDisc) {
    holographicDisc.rotation.z = time * 0.2;
    holographicDisc.position.y = 3.5 + Math.sin(time * 0.8) * 0.08;
  }

  const forge = markers.get("forge");
  const forgeGlow = forge?.getObjectByName("forge_glow") as THREE.Mesh | undefined;
  if (forgeGlow) {
    const material = forgeGlow.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 1.2 + Math.sin(time * 2.0) * 0.3;
  }
  const forgeCage = forge?.getObjectByName("forge_cage");
  if (forgeCage) {
    forgeCage.rotation.y = time * 0.15;
    forgeCage.rotation.x = time * 0.1;
  }

  const court = markers.get("court");
  const courtScale = court?.getObjectByName("court_scale");
  if (courtScale) {
    courtScale.rotation.z = Math.sin(time * 0.6) * 0.15;
  }
  const courtBarrier = court?.getObjectByName("court_barrier") as THREE.Mesh | undefined;
  if (courtBarrier) {
    const material = courtBarrier.material as THREE.MeshStandardMaterial;
    material.opacity = 0.04 + Math.sin(time * 1.5) * 0.02;
  }

  const lounge = markers.get("lounge");
  const loungeGlow = lounge?.getObjectByName("lounge_glow") as THREE.Mesh | undefined;
  if (loungeGlow) {
    const material = loungeGlow.material as THREE.MeshStandardMaterial;
    material.opacity = 0.35 + Math.sin(time * 0.8) * 0.1;
  }
  const loungeLanterns = lounge?.getObjectByName("lounge_lanterns");
  if (loungeLanterns) {
    loungeLanterns.children.forEach((child, index) => {
      child.position.y = 1.9 + index * 0.15 + Math.sin(time * 0.5 + index * 2.0) * 0.1;
    });
  }
}
