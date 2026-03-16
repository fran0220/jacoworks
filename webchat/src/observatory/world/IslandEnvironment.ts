import * as THREE from "three";
import { WORLD } from "../types";

// ── Zone definitions (must match ZoneManager) ────────────

interface ZoneDef {
  pos: [number, number];
  style: "plaza" | "office" | "tech" | "admin" | "garden";
}

const ZONE_DEFS: ZoneDef[] = [
  { pos: [0, 0],      style: "plaza" },   // hub  — 中心广场
  { pos: [-18, -42],  style: "office" },   // tower — 办公园区
  { pos: [-40, 22],   style: "tech" },     // forge — 科创园区
  { pos: [38, -18],   style: "admin" },    // court — 行政中心
  { pos: [22, 45],    style: "garden" },   // lounge — 生态花园
];

const ZONE_COLORS: number[] = [0x06b6d4, 0x3b82f6, 0xf97316, 0x22c55e, 0xe2e8f0];

// ── Road connections between zone indices ────────────────

const ROAD_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4], // hub to all
  [1, 3], // office ↔ admin (northeast corridor)
  [2, 4], // tech ↔ garden (south corridor)
];

// ── Interfaces ───────────────────────────────────────────

interface TwinkleStar {
  baseSize: number;
  phase: number;
  speed: number;
}

interface ParticleData {
  baseY: number;
  phase: number;
  speed: number;
}

interface BuildingInstance {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

interface RoadParticle {
  roadIdx: number;
  progress: number;
  speed: number;
}

// ── Window texture generator (warm city night look) ──────

function generateWindowTexture(litChance = 0.55): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 64, 128);

  // Warm white/amber window colors — real city at night
  const windowColors = ["#ffe8c0", "#fff5e0", "#ffd4a0", "#ffffff", "#ffe0b0", "#fff0d0"];
  const cols = 7;
  const rows = 14;
  const ww = 4;
  const wh = 5;
  const padX = 4;
  const padY = 3;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > litChance) continue;
      ctx.fillStyle = windowColors[Math.floor(Math.random() * windowColors.length)];
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

// ── Building placement ───────────────────────────────────

function placeZoneBuildings(
  zone: ZoneDef,
  count: number,
): BuildingInstance[] {
  const result: BuildingInstance[] = [];
  const [cx, cz] = zone.pos;
  let attempts = 0;

  // Style-specific parameters
  let minH: number, maxH: number, minW: number, maxW: number;
  let spread: number;

  switch (zone.style) {
    case "office":
      minH = 6; maxH = 18; minW = 1.5; maxW = 3.0; spread = 16; break;
    case "tech":
      minH = 2; maxH = 5; minW = 3.0; maxW = 5.5; spread = 18; break;
    case "admin":
      minH = 4; maxH = 10; minW = 2.0; maxW = 3.5; spread = 14; break;
    case "garden":
      minH = 1; maxH = 3; minW = 1.5; maxW = 2.5; spread = 18; break;
    case "plaza":
      minH = 3; maxH = 8; minW = 1.5; maxW = 3.0; spread = 16; break;
  }

  while (result.length < count && attempts < count * 6) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * spread;
    const x = cx + Math.cos(angle) * dist;
    const z = cz + Math.sin(angle) * dist;

    // Don't place too close to zone center (leave space for marker)
    const toCenterDist = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
    if (toCenterDist < 5) continue;

    const w = minW + Math.random() * (maxW - minW);
    const h = minH + Math.random() * (maxH - minH);
    const d = minW + Math.random() * (maxW - minW);
    result.push({ x, z, w, h, d });
  }
  return result;
}

function placeFillBuildings(count: number, maxR: number): BuildingInstance[] {
  const result: BuildingInstance[] = [];
  let attempts = 0;

  while (result.length < count && attempts < count * 6) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * maxR;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Skip if too close to any zone center
    let tooClose = false;
    for (const def of ZONE_DEFS) {
      const dx = x - def.pos[0];
      const dz = z - def.pos[1];
      if (dx * dx + dz * dz < 25 * 25) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const w = 1.5 + Math.random() * 3.0;
    const h = 2 + Math.random() * 8;
    const d = 1.5 + Math.random() * 3.0;
    result.push({ x, z, w, h, d });
  }
  return result;
}

// ── IslandEnvironment ────────────────────────────────────

export class IslandEnvironment {
  private shaderMaterials: THREE.ShaderMaterial[] = [];
  private starData: TwinkleStar[] = [];
  private starGeometry!: THREE.BufferGeometry;
  private particleData: ParticleData[] = [];
  private particleGeometry!: THREE.BufferGeometry;
  private billboards: THREE.Mesh[] = [];

  // Road flowing particles
  private roadParticleGeo!: THREE.BufferGeometry;
  private roadParticles: RoadParticle[] = [];
  private roadEndpoints: { ax: number; az: number; bx: number; bz: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.createGround(scene);
    this.createStreetGrid(scene);
    this.createZoneBuildings(scene);
    this.createFillBuildings(scene);
    this.createFarBuildings(scene);
    this.createZoneBeams(scene);
    this.createRoads(scene);
    const { data, geometry } = this.createStarfield(scene);
    this.starData = data;
    this.starGeometry = geometry;
    this.particleGeometry = this.createParticles(scene);
    this.createBillboards(scene);
    this.createGroundFog(scene);
  }

  // ── Ground Plane ─────────────────────────────────────

  private createGround(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(400, 400);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x080810,
      roughness: 0.95,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = WORLD.GROUND_Y;
    scene.add(ground);
  }

  // ── Street Grid (subtle emissive lines) ──────────────

  private createStreetGrid(scene: THREE.Scene) {
    const bs = WORLD.BLOCK_SIZE;
    const range = 120;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff6b35,
      emissive: 0xff6b35,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.2,
      toneMapped: false,
      depthWrite: false,
    });

    const lineH = 0.08;

    for (let z = -range; z <= range; z += bs) {
      const geo = new THREE.BoxGeometry(range * 2, lineH, 0.2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, WORLD.GROUND_Y + lineH / 2 + 0.01, z);
      scene.add(mesh);
    }

    for (let x = -range; x <= range; x += bs) {
      const geo = new THREE.BoxGeometry(0.2, lineH, range * 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, WORLD.GROUND_Y + lineH / 2 + 0.01, 0);
      scene.add(mesh);
    }
  }

  // ── Zone Buildings (style varies per zone) ───────────

  private createZoneBuildings(scene: THREE.Scene) {
    const tex = generateWindowTexture(0.6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x141420,
      emissive: 0xffe8c0,
      emissiveIntensity: 1.8,
      emissiveMap: tex,
      roughness: 0.7,
      metalness: 0.3,
      toneMapped: false,
    });

    const allBuildings: BuildingInstance[] = [];
    for (const zone of ZONE_DEFS) {
      const count = zone.style === "garden" ? 30 : zone.style === "plaza" ? 40 : 80;
      allBuildings.push(...placeZoneBuildings(zone, count));
    }

    if (allBuildings.length === 0) return;

    const baseGeo = new THREE.BoxGeometry(1, 1, 1);
    const instMesh = new THREE.InstancedMesh(baseGeo, mat, allBuildings.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < allBuildings.length; i++) {
      const b = allBuildings[i];
      dummy.position.set(b.x, WORLD.GROUND_Y + b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
    }

    instMesh.instanceMatrix.needsUpdate = true;
    scene.add(instMesh);
  }

  // ── Fill Buildings (generic city, between zones) ─────

  private createFillBuildings(scene: THREE.Scene) {
    const tex = generateWindowTexture(0.45);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x121220,
      emissive: 0xffe8c0,
      emissiveIntensity: 1.5,
      emissiveMap: tex,
      roughness: 0.8,
      metalness: 0.2,
      toneMapped: false,
    });

    const buildings = placeFillBuildings(500, 100);
    if (buildings.length === 0) return;

    const baseGeo = new THREE.BoxGeometry(1, 1, 1);
    const instMesh = new THREE.InstancedMesh(baseGeo, mat, buildings.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      dummy.position.set(b.x, WORLD.GROUND_Y + b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
    }

    instMesh.instanceMatrix.needsUpdate = true;
    scene.add(instMesh);
  }

  // ── Far Background Buildings (silhouettes into fog) ──

  private createFarBuildings(scene: THREE.Scene) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c0c18,
      emissive: 0xffd4a0,
      emissiveIntensity: 0.6,
      roughness: 0.9,
      metalness: 0.1,
      toneMapped: false,
    });

    const buildings: BuildingInstance[] = [];
    let attempts = 0;
    while (buildings.length < 600 && attempts < 5000) {
      attempts++;
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * 80;
      buildings.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        w: 1.0 + Math.random() * 3.0,
        h: 1 + Math.random() * 5,
        d: 1.0 + Math.random() * 3.0,
      });
    }

    const baseGeo = new THREE.BoxGeometry(1, 1, 1);
    const instMesh = new THREE.InstancedMesh(baseGeo, mat, buildings.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      dummy.position.set(b.x, WORLD.GROUND_Y + b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
    }

    instMesh.instanceMatrix.needsUpdate = true;
    scene.add(instMesh);
  }

  // ── Zone Glow Beams (subtle vertical light columns) ──

  private createZoneBeams(scene: THREE.Scene) {
    for (let i = 0; i < ZONE_DEFS.length; i++) {
      const [cx, cz] = ZONE_DEFS[i].pos;
      const color = ZONE_COLORS[i];
      const height = 35 + Math.random() * 15;

      const geo = new THREE.CylinderGeometry(0.25, 0.25, height, 8, 1, true);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.04,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
      });

      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(cx, WORLD.GROUND_Y + height / 2, cz);
      scene.add(beam);

      // Base glow disc
      const discGeo = new THREE.CircleGeometry(2.0, 24);
      const discMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.08,
        toneMapped: false,
        depthWrite: false,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(cx, WORLD.GROUND_Y + 0.05, cz);
      scene.add(disc);
    }
  }

  // ── Roads with flowing light particles ───────────────

  private createRoads(scene: THREE.Scene) {
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0xff8844,
      emissive: 0xff8844,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.25,
      toneMapped: false,
      depthWrite: false,
    });

    // Build road strips
    for (const [ai, bi] of ROAD_CONNECTIONS) {
      const [ax, az] = ZONE_DEFS[ai].pos;
      const [bx, bz] = ZONE_DEFS[bi].pos;
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);

      const geo = new THREE.BoxGeometry(length, 0.06, 0.6);
      const mesh = new THREE.Mesh(geo, roadMat);
      mesh.position.set((ax + bx) / 2, WORLD.GROUND_Y + 0.04, (az + bz) / 2);
      mesh.rotation.y = -angle;
      scene.add(mesh);

      this.roadEndpoints.push({ ax, az, bx, bz });
    }

    // Flowing particles along roads
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const roadIdx = Math.floor(Math.random() * this.roadEndpoints.length);
      const progress = Math.random();
      const speed = 0.08 + Math.random() * 0.12;
      this.roadParticles.push({ roadIdx, progress, speed });

      const ep = this.roadEndpoints[roadIdx];
      positions[i * 3] = ep.ax + (ep.bx - ep.ax) * progress;
      positions[i * 3 + 1] = WORLD.GROUND_Y + 0.2;
      positions[i * 3 + 2] = ep.az + (ep.bz - ep.az) * progress;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.roadParticleGeo = geo;

    const pMat = new THREE.PointsMaterial({
      color: 0xff8844,
      size: 0.15,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, pMat);
    scene.add(points);
  }

  // ── Starfield ────────────────────────────────────────

  private createStarfield(scene: THREE.Scene) {
    const count = 800;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const data: TwinkleStar[] = [];

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 250;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta));
      positions[i * 3 + 2] = r * Math.cos(phi);

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

    const stars = new THREE.Points(geometry, mat);
    scene.add(stars);

    return { data, geometry };
  }

  // ── Atmospheric Particles ────────────────────────────

  private createParticles(scene: THREE.Scene): THREE.BufferGeometry {
    const count = 500;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 120;
      const baseY = 0.5 + Math.random() * 25;

      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = baseY;
      positions[i * 3 + 2] = Math.sin(angle) * r;

      this.particleData.push({
        baseY,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.5,
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffaa66,
      size: 0.05,
      transparent: true,
      opacity: 0.25,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, mat);
    scene.add(particles);

    return geometry;
  }

  // ── Neon Billboards ──────────────────────────────────

  private createBillboards(scene: THREE.Scene) {
    const colors = [0xff6b35, 0x00d4ff, 0xffd700, 0xff2d95, 0x8b5cf6, 0x00ff88];
    const count = 8 + Math.floor(Math.random() * 5);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 60;
      const w = 1.5 + Math.random() * 3.0;
      const h = 1.0 + Math.random() * 2.0;

      const geo = new THREE.PlaneGeometry(w, h);
      const color = colors[i % colors.length];
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        Math.cos(angle) * dist,
        5 + Math.random() * 15,
        Math.sin(angle) * dist,
      );
      mesh.rotation.y = angle + Math.PI / 2;
      mesh.rotation.x = (Math.random() - 0.5) * 0.2;
      scene.add(mesh);
      this.billboards.push(mesh);
    }
  }

  // ── Ground Fog (shader) ──────────────────────────────

  private createGroundFog(scene: THREE.Scene) {
    const fogVert = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const fogFrag = /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float dist = length(p);
        float falloff = 1.0 - smoothstep(0.3, 1.0, dist);
        vec2 uv = vUv * 8.0 + uTime * 0.02;
        float n = noise(uv) * 0.5 + noise(uv * 2.0) * 0.3 + noise(uv * 4.0) * 0.2;
        float alpha = falloff * n * 0.06;
        gl_FragColor = vec4(0.04, 0.04, 0.08, alpha);
      }
    `;

    const fogMat = new THREE.ShaderMaterial({
      vertexShader: fogVert,
      fragmentShader: fogFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shaderMaterials.push(fogMat);

    const fogPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), fogMat);
    fogPlane.rotation.x = -Math.PI / 2;
    fogPlane.position.y = WORLD.GROUND_Y + 0.4;
    scene.add(fogPlane);
  }

  // ── Update Loop ──────────────────────────────────────

  update(time: number) {
    // Shader uniforms (fog)
    for (const mat of this.shaderMaterials) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = time;
    }

    // Star twinkle
    const sizeAttr = this.starGeometry.getAttribute("size") as THREE.BufferAttribute;
    for (let i = 0; i < this.starData.length; i++) {
      const s = this.starData[i];
      sizeAttr.array[i] = s.baseSize * (0.6 + 0.4 * Math.sin(time * s.speed + s.phase));
    }
    sizeAttr.needsUpdate = true;

    // Atmospheric particle drift
    const posAttr = this.particleGeometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.particleData.length; i++) {
      const p = this.particleData[i];
      const drift = (time * p.speed * 0.3) % 30;
      posAttr.array[i * 3 + 1] = p.baseY + drift + Math.sin(time * p.speed + p.phase) * 0.5;
      if (posAttr.array[i * 3 + 1] > 30) {
        posAttr.array[i * 3 + 1] = 0.5;
        p.baseY = 0.5 + Math.random() * 2;
      }
    }
    posAttr.needsUpdate = true;

    // Road flowing particles
    if (this.roadParticleGeo && this.roadParticles.length > 0) {
      const rpAttr = this.roadParticleGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < this.roadParticles.length; i++) {
        const rp = this.roadParticles[i];
        rp.progress += rp.speed * 0.016; // ~60fps
        if (rp.progress > 1) rp.progress -= 1;

        const ep = this.roadEndpoints[rp.roadIdx];
        rpAttr.array[i * 3] = ep.ax + (ep.bx - ep.ax) * rp.progress;
        rpAttr.array[i * 3 + 1] = WORLD.GROUND_Y + 0.2 + Math.sin(rp.progress * Math.PI) * 0.3;
        rpAttr.array[i * 3 + 2] = ep.az + (ep.bz - ep.az) * rp.progress;
      }
      rpAttr.needsUpdate = true;
    }

    // Billboard slow rotation
    for (const bb of this.billboards) {
      bb.rotation.y += 0.002;
    }
  }
}
