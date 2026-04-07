import * as THREE from "three";

const CURVE_SAMPLES = 20;
const RIBBON_HALF_WIDTH = 0.15;
const PARTICLES_PER_BEAM = 8;

interface BeamEntry {
  id: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: number;
  ribbon: THREE.Mesh;
  ribbonMat: THREE.ShaderMaterial;
  particlePoints: THREE.Points;
  particleGeo: THREE.BufferGeometry;
  particleMat: THREE.PointsMaterial;
  particleSpeeds: number[];
  particleProgress: number[];
  curve: THREE.QuadraticBezierCurve3;
}

function buildCurve(from: THREE.Vector3, to: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const dist = from.distanceTo(to);
  mid.y += dist * 0.3;
  return new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
}

function buildRibbonGeometry(curve: THREE.QuadraticBezierCurve3): THREE.BufferGeometry {
  const pts = curve.getPoints(CURVE_SAMPLES);
  const vertCount = (CURVE_SAMPLES + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const progresses = new Float32Array(vertCount);

  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const offset = new THREE.Vector3();

  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    const t = i / CURVE_SAMPLES;
    curve.getPointAt(t, tangent);
    // use actual point, recompute tangent
    const p = pts[i];

    // approximate tangent
    if (i < CURVE_SAMPLES) {
      tangent.subVectors(pts[i + 1], p).normalize();
    } else {
      tangent.subVectors(p, pts[i - 1]).normalize();
    }

    offset.crossVectors(tangent, up).normalize().multiplyScalar(RIBBON_HALF_WIDTH);

    const ai = i * 2;
    const bi = i * 2 + 1;

    positions[ai * 3] = p.x + offset.x;
    positions[ai * 3 + 1] = p.y + offset.y;
    positions[ai * 3 + 2] = p.z + offset.z;

    positions[bi * 3] = p.x - offset.x;
    positions[bi * 3 + 1] = p.y - offset.y;
    positions[bi * 3 + 2] = p.z - offset.z;

    progresses[ai] = t;
    progresses[bi] = t;
  }

  // indices: quad strip
  const indices: number[] = [];
  for (let i = 0; i < CURVE_SAMPLES; i += 1) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aProgress", new THREE.BufferAttribute(progresses, 1));
  geo.setIndex(indices);
  return geo;
}

function createRibbonMaterial(color: number): THREE.ShaderMaterial {
  const c = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: c },
    },
    vertexShader: /* glsl */ `
      attribute float aProgress;
      varying float vProgress;
      void main() {
        vProgress = aProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying float vProgress;
      void main() {
        float pulse = sin(uTime * 3.0 + vProgress * 6.0) * 0.3 + 0.7;
        float alpha = pulse * 0.6;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function createFlowParticles(
  curve: THREE.QuadraticBezierCurve3,
  color: number,
): {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.PointsMaterial;
  speeds: number[];
  progress: number[];
} {
  const positions = new Float32Array(PARTICLES_PER_BEAM * 3);
  const speeds: number[] = [];
  const progress: number[] = [];
  const tmp = new THREE.Vector3();

  for (let i = 0; i < PARTICLES_PER_BEAM; i += 1) {
    const p = Math.random();
    const s = 0.2 + Math.random() * 0.3;
    progress.push(p);
    speeds.push(s);

    curve.getPoint(p, tmp);
    positions[i * 3] = tmp.x;
    positions[i * 3 + 1] = tmp.y;
    positions[i * 3 + 2] = tmp.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color,
    size: 0.2,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  return { points: pts, geo, mat, speeds, progress };
}

export class CollaborationBeam {
  private scene: THREE.Scene;
  private beams = new Map<string, BeamEntry>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 创建两个 Agent 间的光束 */
  connect(
    fromPosition: THREE.Vector3,
    toPosition: THREE.Vector3,
    color: number,
    id: string,
  ): void {
    if (this.beams.has(id)) this.disconnect(id);

    const curve = buildCurve(fromPosition, toPosition);
    const ribbonGeo = buildRibbonGeometry(curve);
    const ribbonMat = createRibbonMaterial(color);
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    this.scene.add(ribbon);

    const flow = createFlowParticles(curve, color);
    this.scene.add(flow.points);

    this.beams.set(id, {
      id,
      from: fromPosition.clone(),
      to: toPosition.clone(),
      color,
      ribbon,
      ribbonMat,
      particlePoints: flow.points,
      particleGeo: flow.geo,
      particleMat: flow.mat,
      particleSpeeds: flow.speeds,
      particleProgress: flow.progress,
      curve,
    });
  }

  /** 移除光束 */
  disconnect(id: string): void {
    const entry = this.beams.get(id);
    if (!entry) return;

    entry.ribbon.geometry.dispose();
    entry.ribbonMat.dispose();
    this.scene.remove(entry.ribbon);

    entry.particleGeo.dispose();
    entry.particleMat.dispose();
    this.scene.remove(entry.particlePoints);

    this.beams.delete(id);
  }

  /** 每帧更新（脉冲动画） */
  update(time: number, _delta: number): void {
    const tmp = new THREE.Vector3();

    for (const entry of this.beams.values()) {
      entry.ribbonMat.uniforms.uTime.value = time;

      const posAttr = entry.particleGeo.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;

      for (let i = 0; i < PARTICLES_PER_BEAM; i += 1) {
        entry.particleProgress[i] += entry.particleSpeeds[i] * 0.016;
        if (entry.particleProgress[i] > 1) entry.particleProgress[i] -= 1;

        entry.curve.getPoint(entry.particleProgress[i], tmp);
        arr[i * 3] = tmp.x;
        arr[i * 3 + 1] = tmp.y;
        arr[i * 3 + 2] = tmp.z;
      }
      posAttr.needsUpdate = true;
    }
  }

  /** 更新端点位置（Agent 在移动） */
  updateEndpoints(id: string, from: THREE.Vector3, to: THREE.Vector3): void {
    const entry = this.beams.get(id);
    if (!entry) return;

    entry.from.copy(from);
    entry.to.copy(to);
    entry.curve = buildCurve(from, to);

    // rebuild ribbon geometry
    const newGeo = buildRibbonGeometry(entry.curve);
    entry.ribbon.geometry.dispose();
    entry.ribbon.geometry = newGeo;
  }

  /** 清理所有 */
  dispose(): void {
    for (const id of [...this.beams.keys()]) {
      this.disconnect(id);
    }
  }
}
