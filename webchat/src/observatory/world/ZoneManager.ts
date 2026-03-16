import * as THREE from "three";
import type { Zone, ZoneId, ZoneSlot } from "../types";

// ── City District Layout (organic, asymmetric) ──────────
//
//       办公园区 (-18, -42)     行政中心 (38, -18)
//                  中心广场 (0, 0)
//    科创园区 (-40, 22)         生态花园 (22, 45)
// 环城快路: ring at radius 48

const Y = 0.15;

const ZONE_DEFS: Record<ZoneId, { label: string; center: [number, number, number]; radius: number; color: number }> = {
  hub:         { label: "中心广场", center: [0, Y, 0],      radius: 5.0, color: 0x06b6d4 },
  tower:       { label: "办公园区", center: [-18, Y, -42],  radius: 5.0, color: 0x3b82f6 },
  forge:       { label: "科创园区", center: [-40, Y, 22],   radius: 6.0, color: 0xf97316 },
  court:       { label: "行政中心", center: [38, Y, -18],   radius: 5.0, color: 0x22c55e },
  lounge:      { label: "生态花园", center: [22, Y, 45],    radius: 6.0, color: 0xe2e8f0 },
  patrol_path: { label: "环城快路", center: [0, Y, 0],      radius: 48.0, color: 0xa855f7 },
};

function makeSlots(center: THREE.Vector3, count: number, pattern: "semicircle" | "row" | "circle" | "scatter" | "ring", radius: number): ZoneSlot[] {
  const slots: ZoneSlot[] = [];
  for (let i = 0; i < count; i++) {
    let x = center.x, z = center.z;
    switch (pattern) {
      case "semicircle": {
        const angle = (-Math.PI / 4) + (Math.PI / 2) * (i / Math.max(count - 1, 1));
        x += Math.sin(angle) * radius;
        z += Math.cos(angle) * radius;
        break;
      }
      case "row": {
        const offset = (i - (count - 1) / 2) * 0.8;
        x += offset;
        break;
      }
      case "circle": {
        const angle = (2 * Math.PI * i) / count;
        x += Math.cos(angle) * radius;
        z += Math.sin(angle) * radius;
        break;
      }
      case "scatter": {
        const angle = (2 * Math.PI * i) / count + (i % 2 === 0 ? 0.3 : -0.2);
        const r = radius * (0.5 + 0.5 * ((i % 3) / 2));
        x += Math.cos(angle) * r;
        z += Math.sin(angle) * r;
        break;
      }
      case "ring": {
        const angle = (2 * Math.PI * i) / count;
        x += Math.cos(angle) * radius;
        z += Math.sin(angle) * radius;
        break;
      }
    }
    slots.push({ position: new THREE.Vector3(x, Y, z), occupied: false, agentId: null });
  }
  return slots;
}

// ── Zone text label ──────────────────────────────────────

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
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}

// ── Marker builders ─────────────────────────────────────

function addBeacon(parent: THREE.Group, color: number, height: number) {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }),
  );
  sphere.position.y = height;
  parent.add(sphere);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 2.5, 6),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0, transparent: true, opacity: 0.12 }),
  );
  beam.position.y = height + 1.25;
  parent.add(beam);
}

function buildTower(): THREE.Group {
  const g = new THREE.Group();
  const darkBody = 0x12203a;
  const accent = 0x3b82f6;

  // octagonal base platform
  const basePlat = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 0.15, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a2a4a, metalness: 0.7, roughness: 0.4 }),
  );
  basePlat.position.y = 0.075;
  g.add(basePlat);

  // 3-tier stacked building
  const tiers: [number, number, number, number][] = [
    [1.6, 1.2, 1.6, 0.75],
    [1.2, 1.0, 1.2, 1.9],
    [0.8, 0.8, 0.8, 2.8],
  ];
  const bodyMat = new THREE.MeshStandardMaterial({ color: darkBody, metalness: 0.6, roughness: 0.3 });
  for (const [w, h, d, y] of tiers) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
    box.position.y = y;
    g.add(box);
    // emissive window strip on front face
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.8, 0.06, 0.01),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 }),
    );
    strip.position.set(0, y, d / 2 + 0.005);
    g.add(strip);
  }

  // floating holographic core
  const crystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.35, 1),
    new THREE.MeshStandardMaterial({ color: accent, emissive: 0x1d4ed8, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }),
  );
  crystal.position.y = 4.0;
  crystal.name = "tower_crystal";
  g.add(crystal);

  // hovering holo ring
  const holoDisc = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.025, 8, 32),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.5 }),
  );
  holoDisc.rotation.x = Math.PI / 2;
  holoDisc.position.y = 3.5;
  holoDisc.name = "tower_holo_disc";
  g.add(holoDisc);

  // antenna spires at corners
  const antMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.4 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.01, 1.0, 6), antMat);
      ant.position.set(sx * 0.5, 3.6, sz * 0.5);
      g.add(ant);
    }
  }

  addBeacon(g, accent, 5.0);
  return g;
}

function buildForge(): THREE.Group {
  const g = new THREE.Group();
  const accent = 0xf97316;
  const dark = 0x1a1208;

  // base platform
  const basePlat = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1510, metalness: 0.8, roughness: 0.3 }),
  );
  basePlat.position.y = 0.06;
  g.add(basePlat);

  // open-front structure: 3 wall panels (left, right, back)
  const wallMat = new THREE.MeshStandardMaterial({ color: dark, metalness: 0.5, roughness: 0.4 });
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.8), wallMat);
  leftWall.position.set(-1.05, 0.87, 0);
  g.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.8), wallMat);
  rightWall.position.set(1.05, 0.87, 0);
  g.add(rightWall);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.08), wallMat);
  backWall.position.set(0, 0.87, -0.85);
  g.add(backWall);

  // energy core
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.5, transparent: true, opacity: 0.7 }),
  );
  glow.position.y = 1.0;
  glow.name = "forge_glow";
  g.add(glow);

  // wireframe cage
  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.35 }),
  );
  cage.position.y = 1.0;
  cage.name = "forge_cage";
  g.add(cage);

  // screen panels on inner side walls
  for (const sx of [-1, 1]) {
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.35, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: accent, emissiveIntensity: 0.3 }),
    );
    screen.position.set(sx * 0.7, 1.2, 0);
    screen.rotation.y = sx * -0.3;
    g.add(screen);
  }

  // ground light ring
  const groundRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.02, 4, 32),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.35 }),
  );
  groundRing.rotation.x = Math.PI / 2;
  groundRing.position.y = 0.13;
  g.add(groundRing);

  addBeacon(g, accent, 3.0);
  return g;
}

function buildCourt(): THREE.Group {
  const g = new THREE.Group();
  const accent = 0x22c55e;
  const emColor = 0x15803d;

  // half-hex base
  const basePlat = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.1, 6),
    new THREE.MeshStandardMaterial({ color: 0x0a1a10, metalness: 0.5, roughness: 0.4 }),
  );
  basePlat.position.y = 0.05;
  g.add(basePlat);

  // two tall energy pillars
  for (const sx of [-1, 1]) {
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 3, 12),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.5, transparent: true, opacity: 0.3 }),
    );
    outer.position.set(sx * 0.8, 1.5, 0);
    g.add(outer);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 2.8, 8),
      new THREE.MeshStandardMaterial({ color: emColor, emissive: accent, emissiveIntensity: 1.5 }),
    );
    inner.position.set(sx * 0.8, 1.5, 0);
    g.add(inner);
  }

  // scan barrier between pillars
  const barrier = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 2.6),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.2, transparent: true, opacity: 0.05, side: THREE.DoubleSide }),
  );
  barrier.position.y = 1.5;
  barrier.name = "court_barrier";
  g.add(barrier);

  // floating balance scale group
  const scaleGroup = new THREE.Group();
  scaleGroup.name = "court_scale";
  scaleGroup.position.y = 2.8;
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6 }),
  );
  bar.rotation.z = Math.PI / 2;
  scaleGroup.add(bar);
  const scaleMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0 });
  for (const sx of [-1, 1]) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), scaleMat);
    sp.position.x = sx * 0.45;
    scaleGroup.add(sp);
  }
  g.add(scaleGroup);

  // top arch
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.02, 4, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8, transparent: true, opacity: 0.4 }),
  );
  arch.position.y = 3.1;
  arch.rotation.z = Math.PI / 2;
  g.add(arch);

  addBeacon(g, accent, 4.5);
  return g;
}

function buildLounge(): THREE.Group {
  const g = new THREE.Group();
  const accent = 0xffe4b5;

  // circular base platform
  const basePlat = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a1812, metalness: 0.4, roughness: 0.5 }),
  );
  basePlat.position.y = 0.04;
  g.add(basePlat);

  // central fountain orb
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff5e6, emissive: accent, emissiveIntensity: 0.8, transparent: true, opacity: 0.45 }),
  );
  orb.position.y = 1.0;
  orb.name = "lounge_glow";
  g.add(orb);

  // 4 curved seating arcs
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, metalness: 0.3, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 4, 12, Math.PI / 3), seatMat);
    arc.rotation.x = Math.PI / 2;
    arc.rotation.z = (i * Math.PI) / 2;
    arc.position.y = 0.2;
    g.add(arc);
  }

  // 3 floating lanterns
  const lanterns = new THREE.Group();
  lanterns.name = "lounge_lanterns";
  const lanternPositions: [number, number, number][] = [
    [-0.4, 1.9, 0.3],
    [0.3, 2.05, -0.4],
    [0.0, 2.2, 0.5],
  ];
  for (const [lx, ly, lz] of lanternPositions) {
    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.2, transparent: true, opacity: 0.6 }),
    );
    lantern.position.set(lx, ly, lz);
    lanterns.add(lantern);
  }
  g.add(lanterns);

  // concentric ground rings
  for (const r of [0.6, 1.0]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.015, 4, 32),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8, transparent: true, opacity: 0.15 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    g.add(ring);
  }

  addBeacon(g, accent, 2.8);
  return g;
}

function buildHub(): THREE.Group {
  const g = new THREE.Group();
  const accent = 0x06b6d4;

  // hexagonal base
  const basePlat = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 0.15, 6),
    new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.6, roughness: 0.4 }),
  );
  basePlat.position.y = 0.075;
  g.add(basePlat);

  // edge glow
  const edgeGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(2.05, 2.05, 0.16, 6, 1, true),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
  );
  edgeGlow.position.y = 0.08;
  g.add(edgeGlow);

  // ring 1 (main)
  const ring1 = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.04, 8, 48),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.7 }),
  );
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 1.5;
  ring1.name = "hub_ring";
  g.add(ring1);

  // ring 2
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.03, 8, 36),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.5 }),
  );
  ring2.rotation.x = Math.PI / 3;
  ring2.rotation.z = Math.PI / 6;
  ring2.position.y = 1.8;
  ring2.name = "hub_ring_2";
  g.add(ring2);

  // ring 3
  const ring3 = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.025, 6, 24),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0, transparent: true, opacity: 0.4 }),
  );
  ring3.rotation.x = Math.PI / 2.5;
  ring3.rotation.z = -Math.PI / 4;
  ring3.position.y = 2.0;
  ring3.name = "hub_ring_3";
  g.add(ring3);

  // central core point
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 8),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.0 }),
  );
  core.position.y = 1.7;
  g.add(core);

  // 4 orbiting data nodes
  const satellites = new THREE.Group();
  satellites.name = "hub_satellites";
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI * 2) / 4;
    const node = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8 }),
    );
    node.position.set(Math.cos(angle) * 1.8, 1.0, Math.sin(angle) * 1.8);
    satellites.add(node);
  }
  g.add(satellites);

  addBeacon(g, accent, 3.5);
  return g;
}

function buildPatrolPath(): THREE.Group {
  const g = new THREE.Group();

  // main dashed torus ring
  const geo = new THREE.TorusGeometry(48, 0.06, 4, 160);
  const mat = new THREE.LineDashedMaterial({ color: 0xa855f7, dashSize: 0.6, gapSize: 0.3, transparent: true, opacity: 0.5 });
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, mat);
  line.computeLineDistances();
  line.rotation.x = Math.PI / 2;
  line.position.y = 0.05;
  g.add(line);

  // 8 checkpoint markers + vertical light beams
  const dots = new THREE.Group();
  dots.name = "patrol_dots";
  const cpMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 1.0 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 1.0, transparent: true, opacity: 0.2 });
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI * 2) / 8;
    const px = Math.cos(angle) * 48;
    const pz = Math.sin(angle) * 48;

    const cp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), cpMat);
    cp.position.set(px, Y, pz);
    dots.add(cp);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6), beamMat);
    beam.position.set(px, Y + 0.3, pz);
    dots.add(beam);
  }
  g.add(dots);

  return g;
}

// ── ZoneManager ─────────────────────────────────────────

export class ZoneManager {
  private zones = new Map<ZoneId, Zone>();
  private markers = new Map<ZoneId, THREE.Group>();
  private root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.root.name = "zones";
    scene.add(this.root);

    const builders: Record<ZoneId, () => THREE.Group> = {
      tower: buildTower,
      forge: buildForge,
      court: buildCourt,
      lounge: buildLounge,
      hub: buildHub,
      patrol_path: buildPatrolPath,
    };

    const slotConfigs: Record<ZoneId, { count: number; pattern: "semicircle" | "row" | "circle" | "scatter" | "ring"; slotRadius: number }> = {
      hub:         { count: 4, pattern: "circle",     slotRadius: 3.0 },
      tower:       { count: 3, pattern: "semicircle", slotRadius: 3.5 },
      forge:       { count: 5, pattern: "row",        slotRadius: 4.5 },
      court:       { count: 3, pattern: "semicircle", slotRadius: 3.5 },
      lounge:      { count: 6, pattern: "scatter",    slotRadius: 4.5 },
      patrol_path: { count: 8, pattern: "ring",       slotRadius: 48.0 },
    };

    for (const [id, def] of Object.entries(ZONE_DEFS) as [ZoneId, typeof ZONE_DEFS[ZoneId]][]) {
      const center = new THREE.Vector3(...def.center);
      const sc = slotConfigs[id];
      const zone: Zone = {
        id,
        label: def.label,
        center,
        radius: def.radius,
        slots: makeSlots(center, sc.count, sc.pattern, sc.slotRadius),
        markerColor: def.color,
      };
      this.zones.set(id, zone);

      const marker = builders[id]();
      marker.position.copy(center);
      marker.name = `zone_${id}`;

      // Add floating text label above zone
      if (id !== "patrol_path") {
        const label = createZoneLabel(def.label, def.color);
        label.position.set(0, 8, 0);
        marker.add(label);
      }

      this.root.add(marker);
      this.markers.set(id, marker);
    }
  }

  getZone(id: ZoneId): Zone {
    const z = this.zones.get(id);
    if (!z) throw new Error(`Unknown zone: ${id}`);
    return z;
  }

  claimSlot(zoneId: ZoneId, agentId: string): ZoneSlot | null {
    const zone = this.getZone(zoneId);
    const slot = zone.slots.find((s) => !s.occupied);
    if (!slot) return null;
    slot.occupied = true;
    slot.agentId = agentId;
    return slot;
  }

  releaseSlot(zoneId: ZoneId, agentId: string): void {
    const zone = this.getZone(zoneId);
    const slot = zone.slots.find((s) => s.agentId === agentId);
    if (slot) {
      slot.occupied = false;
      slot.agentId = null;
    }
  }

  update(time: number) {
    // hub rings: independent rotations
    const hub = this.markers.get("hub");
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

    // hub satellites: orbit around center
    const hubSats = hub?.getObjectByName("hub_satellites");
    if (hubSats) {
      hubSats.children.forEach((child, i) => {
        child.position.x = Math.cos(time * 0.5 + i * Math.PI / 2) * 1.8;
        child.position.z = Math.sin(time * 0.5 + i * Math.PI / 2) * 1.8;
      });
    }

    // tower crystal: gentle bob + spin
    const tower = this.markers.get("tower");
    const crystal = tower?.getObjectByName("tower_crystal");
    if (crystal) {
      crystal.position.y = 4.0 + Math.sin(time * 1.5) * 0.12;
      crystal.rotation.y = time * 0.5;
    }

    // tower holo disc: slow rotation + bob
    const holoDisc = tower?.getObjectByName("tower_holo_disc");
    if (holoDisc) {
      holoDisc.rotation.z = time * 0.2;
      holoDisc.position.y = 3.5 + Math.sin(time * 0.8) * 0.08;
    }

    // forge glow: pulse emissive intensity
    const forge = this.markers.get("forge");
    const forgeGlow = forge?.getObjectByName("forge_glow") as THREE.Mesh | undefined;
    if (forgeGlow) {
      const mat = forgeGlow.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.2 + Math.sin(time * 2.0) * 0.3;
    }

    // forge cage: slow rotation
    const forgeCage = forge?.getObjectByName("forge_cage");
    if (forgeCage) {
      forgeCage.rotation.y = time * 0.15;
      forgeCage.rotation.x = time * 0.1;
    }

    // court scale: gentle seesaw
    const court = this.markers.get("court");
    const courtScale = court?.getObjectByName("court_scale");
    if (courtScale) {
      courtScale.rotation.z = Math.sin(time * 0.6) * 0.15;
    }

    // court barrier: subtle opacity pulse
    const courtBarrier = court?.getObjectByName("court_barrier") as THREE.Mesh | undefined;
    if (courtBarrier) {
      const mat = courtBarrier.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.04 + Math.sin(time * 1.5) * 0.02;
    }

    // lounge glow: slow breathe
    const lounge = this.markers.get("lounge");
    const loungeGlow = lounge?.getObjectByName("lounge_glow") as THREE.Mesh | undefined;
    if (loungeGlow) {
      const mat = loungeGlow.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.35 + Math.sin(time * 0.8) * 0.1;
    }

    // lounge lanterns: gentle float
    const loungeLanterns = lounge?.getObjectByName("lounge_lanterns");
    if (loungeLanterns) {
      loungeLanterns.children.forEach((child, i) => {
        child.position.y = 1.9 + i * 0.15 + Math.sin(time * 0.5 + i * 2.0) * 0.1;
      });
    }
  }
}
