import * as THREE from "three";

export interface CityParticleSystem {
  /** 每帧更新 */
  update(time: number, delta: number): void;
  /** 清理 */
  dispose(): void;
}

/* ── Zone coordinates ── */

interface ZoneInfo {
  pos: [number, number];
  color: number;
}

const ZONES: Record<string, ZoneInfo> = {
  city_hall: { pos: [0, 0], color: 0x06b6d4 },
  innovation_center: { pos: [30, -55], color: 0x3b82f6 },
  data_hub: { pos: [107, 55], color: 0xf97316 },
  esports_center: { pos: [436, 300], color: 0xff2d95 },
  robotics_park: { pos: [192, -66], color: 0x22c55e },
  tongming_lake: { pos: [-107, -100], color: 0x00d4ff },
  logistics_port: { pos: [276, 144], color: 0xffd700 },
  eco_garden: { pos: [-46, 111], color: 0x8b5cf6 },
};

const ZONE_LIST = Object.values(ZONES);

const DATA_CONNECTIONS: [string, string][] = [
  ["city_hall", "innovation_center"],
  ["city_hall", "data_hub"],
  ["city_hall", "eco_garden"],
  ["innovation_center", "robotics_park"],
  ["data_hub", "logistics_port"],
  ["logistics_port", "esports_center"],
  ["tongming_lake", "eco_garden"],
  ["robotics_park", "data_hub"],
];

/* ── Star types ── */

interface TwinkleStar {
  baseSize: number;
  phase: number;
  speed: number;
}

interface DustParticle {
  baseY: number;
  phase: number;
  speed: number;
}

interface DataParticle {
  connIdx: number;
  progress: number;
  speed: number;
}

interface HaloParticle {
  zoneIdx: number;
  angle: number;
  baseY: number;
  speed: number;
}

/* ── Starfield (800) ── */

function createStarfield(scene: THREE.Scene) {
  const count = 800;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const data: TwinkleStar[] = [];

  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random()); // hemisphere (0..π/2)
    const r = 800;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi));
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const baseSize = 0.06 + Math.random() * 0.18;
    sizes[i] = baseSize;
    data.push({
      baseSize,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 2.0,
    });

    const warmth = Math.random() * 0.4;
    colors[i * 3] = 1.0;
    colors[i * 3 + 1] = 1.0 - warmth * 0.2;
    colors[i * 3 + 2] = 1.0 - warmth;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    size: 0.18,
  });

  const points = new THREE.Points(geometry, mat);
  scene.add(points);

  return { geometry, data, points, material: mat };
}

/* ── Atmospheric Dust (300) ── */

function createDust(scene: THREE.Scene) {
  const count = 300;
  const positions = new Float32Array(count * 3);
  const data: DustParticle[] = [];

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 400;
    const baseY = 0.5 + Math.random() * 29.5;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = baseY;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    data.push({
      baseY,
      phase: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random() * 0.5,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffaa66,
    size: 0.04,
    transparent: true,
    opacity: 0.2,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, mat);
  scene.add(points);

  return { geometry, data, points, material: mat };
}

/* ── Data Flow Particles (150) ── */

function createDataFlow(scene: THREE.Scene) {
  const count = 150;
  const positions = new Float32Array(count * 3);
  const data: DataParticle[] = [];

  for (let i = 0; i < count; i += 1) {
    const connIdx = Math.floor(Math.random() * DATA_CONNECTIONS.length);
    const progress = Math.random();
    const speed = 0.05 + Math.random() * 0.1;
    data.push({ connIdx, progress, speed });

    const [fromKey, toKey] = DATA_CONNECTIONS[connIdx];
    const from = ZONES[fromKey].pos;
    const to = ZONES[toKey].pos;
    positions[i * 3] = from[0] + (to[0] - from[0]) * progress;
    positions[i * 3 + 1] = Math.sin(progress * Math.PI) * 0.8;
    positions[i * 3 + 2] = from[1] + (to[1] - from[1]) * progress;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xff8844,
    size: 0.12,
    transparent: true,
    opacity: 0.5,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, mat);
  scene.add(points);

  return { geometry, data, points, material: mat };
}

/* ── Zone Halos (40 per zone × 8 = 320) ── */

function createZoneHalos(scene: THREE.Scene) {
  const perZone = 40;
  const count = ZONE_LIST.length * perZone;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const data: HaloParticle[] = [];

  const tmpColor = new THREE.Color();

  for (let z = 0; z < ZONE_LIST.length; z += 1) {
    const zone = ZONE_LIST[z];
    tmpColor.set(zone.color);

    for (let j = 0; j < perZone; j += 1) {
      const idx = z * perZone + j;
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 8;
      const baseY = 5 + Math.random() * 15;

      positions[idx * 3] = zone.pos[0] + Math.cos(angle) * radius;
      positions[idx * 3 + 1] = baseY;
      positions[idx * 3 + 2] = zone.pos[1] + Math.sin(angle) * radius;

      colors[idx * 3] = tmpColor.r;
      colors[idx * 3 + 1] = tmpColor.g;
      colors[idx * 3 + 2] = tmpColor.b;

      data.push({
        zoneIdx: z,
        angle,
        baseY,
        speed: 0.1 + Math.random() * 0.3,
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.08,
    transparent: true,
    opacity: 0.3,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, mat);
  scene.add(points);

  return { geometry, data, points, material: mat };
}

/* ── Public factory ── */

/** 创建城市粒子系统 */
export function createCityParticles(scene: THREE.Scene): CityParticleSystem {
  const stars = createStarfield(scene);
  const dust = createDust(scene);
  const dataFlow = createDataFlow(scene);
  const halos = createZoneHalos(scene);

  return {
    update(time: number, _delta: number) {
      // Starfield twinkle
      const sizeAttr = stars.geometry.getAttribute("size") as THREE.BufferAttribute;
      for (let i = 0; i < stars.data.length; i += 1) {
        const s = stars.data[i];
        (sizeAttr.array as Float32Array)[i] =
          s.baseSize * (0.6 + 0.4 * Math.sin(time * s.speed + s.phase));
      }
      sizeAttr.needsUpdate = true;

      // Atmospheric dust – slow rise + sin drift
      const dustPos = dust.geometry.getAttribute("position") as THREE.BufferAttribute;
      const dArr = dustPos.array as Float32Array;
      for (let i = 0; i < dust.data.length; i += 1) {
        const p = dust.data[i];
        const drift = (time * p.speed * 0.3) % 30;
        let y = p.baseY + drift + Math.sin(time * p.speed + p.phase) * 0.5;
        if (y > 30) {
          y = 0.5;
          p.baseY = 0.5 + Math.random() * 2;
        }
        dArr[i * 3 + 1] = y;
      }
      dustPos.needsUpdate = true;

      // Data flow – progress along connections
      const dfPos = dataFlow.geometry.getAttribute("position") as THREE.BufferAttribute;
      const dfArr = dfPos.array as Float32Array;
      for (let i = 0; i < dataFlow.data.length; i += 1) {
        const dp = dataFlow.data[i];
        dp.progress += dp.speed * 0.016;
        if (dp.progress > 1) dp.progress -= 1;

        const [fromKey, toKey] = DATA_CONNECTIONS[dp.connIdx];
        const from = ZONES[fromKey].pos;
        const to = ZONES[toKey].pos;
        dfArr[i * 3] = from[0] + (to[0] - from[0]) * dp.progress;
        dfArr[i * 3 + 1] = Math.sin(dp.progress * Math.PI) * 0.8;
        dfArr[i * 3 + 2] = from[1] + (to[1] - from[1]) * dp.progress;
      }
      dfPos.needsUpdate = true;

      // Zone halos – rotate + slow rise
      const haloPos = halos.geometry.getAttribute("position") as THREE.BufferAttribute;
      const hArr = haloPos.array as Float32Array;
      for (let i = 0; i < halos.data.length; i += 1) {
        const h = halos.data[i];
        const zone = ZONE_LIST[h.zoneIdx];
        h.angle += h.speed * 0.016;
        const radius = 3 + Math.random() * 8;
        const yOff = Math.sin(time * h.speed + h.baseY) * 1.5;
        hArr[i * 3] = zone.pos[0] + Math.cos(h.angle) * radius;
        hArr[i * 3 + 1] = h.baseY + yOff;
        hArr[i * 3 + 2] = zone.pos[1] + Math.sin(h.angle) * radius;
      }
      haloPos.needsUpdate = true;
    },

    dispose() {
      stars.geometry.dispose();
      stars.material.dispose();
      scene.remove(stars.points);

      dust.geometry.dispose();
      dust.material.dispose();
      scene.remove(dust.points);

      dataFlow.geometry.dispose();
      dataFlow.material.dispose();
      scene.remove(dataFlow.points);

      halos.geometry.dispose();
      halos.material.dispose();
      scene.remove(halos.points);
    },
  };
}
