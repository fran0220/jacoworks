import * as THREE from "three";
import type { ZoneId } from "../../types";
import { ZONE_HEIGHT_Y } from "./registry";

function createZoneLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  ctx.shadowColor = hex;
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}

function addBeacon(parent: THREE.Group, color: number, height: number) {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }),
  );
  sphere.position.y = height;
  parent.add(sphere);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 2.5, 6),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.12,
    }),
  );
  beam.position.y = height + 1.25;
  parent.add(beam);
}

function buildTower(): THREE.Group {
  const group = new THREE.Group();
  const darkBody = 0x12203a;
  const accent = 0x3b82f6;

  const basePlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 0.15, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a2a4a, metalness: 0.7, roughness: 0.4 }),
  );
  basePlatform.position.y = 0.075;
  group.add(basePlatform);

  const tiers: [number, number, number, number][] = [
    [1.6, 1.2, 1.6, 0.75],
    [1.2, 1.0, 1.2, 1.9],
    [0.8, 0.8, 0.8, 2.8],
  ];
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: darkBody,
    metalness: 0.6,
    roughness: 0.3,
  });
  for (const [w, h, d, y] of tiers) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMaterial);
    box.position.y = y;
    group.add(box);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.8, 0.06, 0.01),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7,
      }),
    );
    strip.position.set(0, y, d / 2 + 0.005);
    group.add(strip);
  }

  const crystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.35, 1),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: 0x1d4ed8,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.85,
    }),
  );
  crystal.position.y = 4.0;
  crystal.name = "tower_crystal";
  group.add(crystal);

  const holographicDisc = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.025, 8, 32),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.5,
    }),
  );
  holographicDisc.rotation.x = Math.PI / 2;
  holographicDisc.position.y = 3.5;
  holographicDisc.name = "tower_holo_disc";
  group.add(holographicDisc);

  const antennaMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.4,
  });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.01, 1.0, 6),
        antennaMaterial,
      );
      antenna.position.set(sx * 0.5, 3.6, sz * 0.5);
      group.add(antenna);
    }
  }

  addBeacon(group, accent, 5.0);
  return group;
}

function buildForge(): THREE.Group {
  const group = new THREE.Group();
  const accent = 0xf97316;
  const dark = 0x1a1208;

  const basePlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1510, metalness: 0.8, roughness: 0.3 }),
  );
  basePlatform.position.y = 0.06;
  group.add(basePlatform);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: dark, metalness: 0.5, roughness: 0.4 });
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.8), wallMaterial);
  leftWall.position.set(-1.05, 0.87, 0);
  group.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.8), wallMaterial);
  rightWall.position.set(1.05, 0.87, 0);
  group.add(rightWall);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.08), wallMaterial);
  backWall.position.set(0, 0.87, -0.85);
  group.add(backWall);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.7,
    }),
  );
  glow.position.y = 1.0;
  glow.name = "forge_glow";
  group.add(glow);

  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.35 }),
  );
  cage.position.y = 1.0;
  cage.name = "forge_cage";
  group.add(cage);

  for (const sx of [-1, 1]) {
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.35, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: accent, emissiveIntensity: 0.3 }),
    );
    screen.position.set(sx * 0.7, 1.2, 0);
    screen.rotation.y = sx * -0.3;
    group.add(screen);
  }

  const groundRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.02, 4, 32),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.35,
    }),
  );
  groundRing.rotation.x = Math.PI / 2;
  groundRing.position.y = 0.13;
  group.add(groundRing);

  addBeacon(group, accent, 3.0);
  return group;
}

function buildCourt(): THREE.Group {
  const group = new THREE.Group();
  const accent = 0x22c55e;
  const emColor = 0x15803d;

  const basePlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.1, 6),
    new THREE.MeshStandardMaterial({ color: 0x0a1a10, metalness: 0.5, roughness: 0.4 }),
  );
  basePlatform.position.y = 0.05;
  group.add(basePlatform);

  for (const sx of [-1, 1]) {
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 3, 12),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.3,
      }),
    );
    outer.position.set(sx * 0.8, 1.5, 0);
    group.add(outer);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 2.8, 8),
      new THREE.MeshStandardMaterial({ color: emColor, emissive: accent, emissiveIntensity: 1.5 }),
    );
    inner.position.set(sx * 0.8, 1.5, 0);
    group.add(inner);
  }

  const barrier = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 2.6),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
    }),
  );
  barrier.position.y = 1.5;
  barrier.name = "court_barrier";
  group.add(barrier);

  const scaleGroup = new THREE.Group();
  scaleGroup.name = "court_scale";
  scaleGroup.position.y = 2.8;
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6 }),
  );
  bar.rotation.z = Math.PI / 2;
  scaleGroup.add(bar);
  const scaleMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 1.0,
  });
  for (const sx of [-1, 1]) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), scaleMaterial);
    sphere.position.x = sx * 0.45;
    scaleGroup.add(sphere);
  }
  group.add(scaleGroup);

  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.02, 4, 16, Math.PI),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.4,
    }),
  );
  arch.position.y = 3.1;
  arch.rotation.z = Math.PI / 2;
  group.add(arch);

  addBeacon(group, accent, 4.5);
  return group;
}

function buildLounge(): THREE.Group {
  const group = new THREE.Group();
  const accent = 0xffe4b5;

  const basePlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a1812, metalness: 0.4, roughness: 0.5 }),
  );
  basePlatform.position.y = 0.04;
  group.add(basePlatform);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xfff5e6,
      emissive: accent,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.45,
    }),
  );
  orb.position.y = 1.0;
  orb.name = "lounge_glow";
  group.add(orb);

  const seatMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2520,
    metalness: 0.3,
    roughness: 0.6,
  });
  for (let i = 0; i < 4; i += 1) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 4, 12, Math.PI / 3), seatMaterial);
    arc.rotation.x = Math.PI / 2;
    arc.rotation.z = (i * Math.PI) / 2;
    arc.position.y = 0.2;
    group.add(arc);
  }

  const lanterns = new THREE.Group();
  lanterns.name = "lounge_lanterns";
  const lanternPositions: [number, number, number][] = [
    [-0.4, 1.9, 0.3],
    [0.3, 2.05, -0.4],
    [0.0, 2.2, 0.5],
  ];
  for (const [x, y, z] of lanternPositions) {
    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.6,
      }),
    );
    lantern.position.set(x, y, z);
    lanterns.add(lantern);
  }
  group.add(lanterns);

  for (const radius of [0.6, 1.0]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.015, 4, 32),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.15,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    group.add(ring);
  }

  addBeacon(group, accent, 2.8);
  return group;
}

function buildHub(): THREE.Group {
  const group = new THREE.Group();
  const accent = 0x06b6d4;

  const basePlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 0.15, 6),
    new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.6, roughness: 0.4 }),
  );
  basePlatform.position.y = 0.075;
  group.add(basePlatform);

  const edgeGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(2.05, 2.05, 0.16, 6, 1, true),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  edgeGlow.position.y = 0.08;
  group.add(edgeGlow);

  const ring1 = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.04, 8, 48),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.7,
    }),
  );
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 1.5;
  ring1.name = "hub_ring";
  group.add(ring1);

  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.03, 8, 36),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.5,
    }),
  );
  ring2.rotation.x = Math.PI / 3;
  ring2.rotation.z = Math.PI / 6;
  ring2.position.y = 1.8;
  ring2.name = "hub_ring_2";
  group.add(ring2);

  const ring3 = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.025, 6, 24),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.4,
    }),
  );
  ring3.rotation.x = Math.PI / 2.5;
  ring3.rotation.z = -Math.PI / 4;
  ring3.position.y = 2.0;
  ring3.name = "hub_ring_3";
  group.add(ring3);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 8),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.0 }),
  );
  core.position.y = 1.7;
  group.add(core);

  const satellites = new THREE.Group();
  satellites.name = "hub_satellites";
  for (let i = 0; i < 4; i += 1) {
    const angle = (i * Math.PI * 2) / 4;
    const node = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8 }),
    );
    node.position.set(Math.cos(angle) * 1.8, 1.0, Math.sin(angle) * 1.8);
    satellites.add(node);
  }
  group.add(satellites);

  addBeacon(group, accent, 3.5);
  return group;
}

function buildPatrolPath(): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.TorusGeometry(48, 0.06, 4, 160);
  const material = new THREE.LineDashedMaterial({
    color: 0xa855f7,
    dashSize: 0.6,
    gapSize: 0.3,
    transparent: true,
    opacity: 0.5,
  });
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(edges, material);
  line.computeLineDistances();
  line.rotation.x = Math.PI / 2;
  line.position.y = 0.05;
  group.add(line);

  const dots = new THREE.Group();
  dots.name = "patrol_dots";
  const checkpointMaterial = new THREE.MeshStandardMaterial({
    color: 0xa855f7,
    emissive: 0xa855f7,
    emissiveIntensity: 1.0,
  });
  const beamMaterial = new THREE.MeshStandardMaterial({
    color: 0xa855f7,
    emissive: 0xa855f7,
    emissiveIntensity: 1.0,
    transparent: true,
    opacity: 0.2,
  });
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI * 2) / 8;
    const px = Math.cos(angle) * 48;
    const pz = Math.sin(angle) * 48;

    const checkpoint = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), checkpointMaterial);
    checkpoint.position.set(px, ZONE_HEIGHT_Y, pz);
    dots.add(checkpoint);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6), beamMaterial);
    beam.position.set(px, ZONE_HEIGHT_Y + 0.3, pz);
    dots.add(beam);
  }
  group.add(dots);

  return group;
}

export const ZONE_MARKER_BUILDERS: Record<ZoneId, () => THREE.Group> = {
  tower: buildTower,
  forge: buildForge,
  court: buildCourt,
  lounge: buildLounge,
  hub: buildHub,
  patrol_path: buildPatrolPath,
};

export function attachZoneLabel(
  marker: THREE.Group,
  zoneId: ZoneId,
  label: string,
  color: number,
) {
  if (zoneId === "patrol_path") return;
  const zoneLabel = createZoneLabel(label, color);
  zoneLabel.position.set(0, 8, 0);
  marker.add(zoneLabel);
}
