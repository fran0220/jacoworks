import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM, VRMUtils } from "@pixiv/three-vrm";
import { getRoleConfig } from "../types";

const VRM_BASE_PATH = "/observatory/vrm/";
const BASE_MODELS = ["base-female.vrm", "base-male.vrm", "base-neutral.vrm"];

export class AvatarPool {
  private loader: GLTFLoader;
  private baseModels: VRM[] = [];
  private instances = new Map<string, { vrm: VRM | null; mesh: THREE.Group | null }>();
  private roundRobinIndex = 0;

  constructor() {
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  async loadBaseModels(): Promise<void> {
    const results = await Promise.allSettled(
      BASE_MODELS.map(
        (file) =>
          new Promise<VRM>((resolve, reject) => {
            this.loader.load(
              VRM_BASE_PATH + file,
              (gltf) => {
                const vrm = gltf.userData.vrm as VRM | undefined;
                if (!vrm) {
                  reject(new Error(`No VRM data in ${file}`));
                  return;
                }
                VRMUtils.removeUnnecessaryJoints(gltf.scene);
                resolve(vrm);
              },
              undefined,
              (err) => reject(err),
            );
          }),
      ),
    );

    for (const r of results) {
      if (r.status === "fulfilled") this.baseModels.push(r.value);
    }

    if (this.baseModels.length === 0) {
      console.warn("[AvatarPool] No VRM base models loaded — will use fallback meshes");
    } else {
      console.info(`[AvatarPool] Loaded ${this.baseModels.length} base VRM model(s)`);
    }
  }

  async createInstance(agentId: string, role: string): Promise<VRM | null> {
    if (this.baseModels.length === 0) return null;

    const base = this.baseModels[this.roundRobinIndex % this.baseModels.length];
    this.roundRobinIndex++;

    // Clone the base VRM scene manually (deepClone not available in this version)
    const clonedScene = base.scene.clone(true);
    const clone = { ...base, scene: clonedScene } as unknown as VRM;
    const rc = getRoleConfig(role);
    const color = new THREE.Color(rc.color);
    const emissive = new THREE.Color(rc.emissive);

    clone.scene.traverse((obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) this.tintMaterial(m, color, emissive);
      } else if (mat) {
        this.tintMaterial(mat, color, emissive);
      }
    });

    this.instances.set(agentId, { vrm: clone, mesh: null });
    return clone;
  }

  releaseInstance(agentId: string): void {
    const entry = this.instances.get(agentId);
    if (!entry) return;
    if (entry.vrm) {
      VRMUtils.deepDispose(entry.vrm.scene);
    }
    if (entry.mesh) {
      entry.mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
    }
    this.instances.delete(agentId);
  }

  getFallbackMesh(role: string): THREE.Group {
    const rc = getRoleConfig(role);
    const color = new THREE.Color(rc.color);
    const group = new THREE.Group();

    // Body capsule
    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.7, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(rc.emissive), emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    group.add(body);

    // Head sphere
    const headGeo = new THREE.SphereGeometry(0.2, 16, 12);
    const headMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(rc.emissive), emissiveIntensity: 0.4 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.25;
    group.add(head);

    return group;
  }

  private tintMaterial(mat: THREE.Material, color: THREE.Color, emissive: THREE.Color): void {
    if ("color" in mat && (mat as THREE.MeshStandardMaterial).color) {
      (mat as THREE.MeshStandardMaterial).color.lerp(color, 0.4);
    }
    if ("emissive" in mat && (mat as THREE.MeshStandardMaterial).emissive) {
      (mat as THREE.MeshStandardMaterial).emissive.copy(emissive);
      (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
    }
  }
}
