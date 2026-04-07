import * as THREE from "three";

const DEFAULT_MAX_POINTS = 30;

export class AgentTrail {
  private scene: THREE.Scene;
  private maxPoints: number;
  private positions: THREE.Vector3[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;
  private positionAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private trailColor: THREE.Color;

  constructor(scene: THREE.Scene, color: number, maxPoints = DEFAULT_MAX_POINTS) {
    this.scene = scene;
    this.maxPoints = maxPoints;
    this.trailColor = new THREE.Color(color);

    const posArray = new Float32Array(maxPoints * 3);
    const colorArray = new Float32Array(maxPoints * 4);

    this.positionAttr = new THREE.BufferAttribute(posArray, 3);
    this.colorAttr = new THREE.BufferAttribute(colorArray, 4);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", this.positionAttr);
    this.geometry.setAttribute("color", this.colorAttr);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      size: 0.15,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
  }

  /** 每帧添加当前位置 */
  addPoint(position: THREE.Vector3): void {
    this.positions.push(position.clone());
    if (this.positions.length > this.maxPoints) {
      this.positions.shift();
    }
  }

  /** 每帧更新（重建 buffer） */
  update(_delta: number): void {
    const count = this.positions.length;
    const pArr = this.positionAttr.array as Float32Array;
    const cArr = this.colorAttr.array as Float32Array;

    for (let i = 0; i < count; i += 1) {
      const p = this.positions[i];
      pArr[i * 3] = p.x;
      pArr[i * 3 + 1] = p.y;
      pArr[i * 3 + 2] = p.z;

      const alpha = count > 1 ? i / (count - 1) : 1;
      cArr[i * 4] = this.trailColor.r;
      cArr[i * 4 + 1] = this.trailColor.g;
      cArr[i * 4 + 2] = this.trailColor.b;
      cArr[i * 4 + 3] = alpha;
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, count);
  }

  /** 设置可见性 */
  setVisible(visible: boolean): void {
    this.points.visible = visible;
  }

  /** 清理 */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.points);
  }
}
