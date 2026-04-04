import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getRoleConfig } from "../types";

export interface GLBAvatar {
  scene: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Record<string, THREE.AnimationClip>;
}

export class AvatarPool {
  private loader: GLTFLoader;
  private instances = new Map<string, THREE.Group>();

  constructor() {
    this.loader = new GLTFLoader();
  }

  async loadGLBAvatar(agentId: string, modelUrl: string, animUrls: Record<string, string>): Promise<GLBAvatar> {
    console.info("[AvatarPool] Loading GLB:", modelUrl);
    const gltf = await this.loader.loadAsync(modelUrl);
    const scene = gltf.scene;
    const mixer = new THREE.AnimationMixer(scene);
    const clips: Record<string, THREE.AnimationClip> = {};

    // Include any clips embedded in the model itself
    for (const clip of gltf.animations) {
      clips[clip.name] = clip;
    }

    // Load external animation GLBs
    const entries = Object.entries(animUrls);
    const results = await Promise.allSettled(
      entries.map(async ([name, url]) => {
        const animGltf = await this.loader.loadAsync(url);
        if (animGltf.animations.length > 0) {
          clips[name] = animGltf.animations[0];
        }
      }),
    );
    for (const r of results) {
      if (r.status === "rejected") console.warn("[AvatarPool] Anim load failed:", r.reason);
    }

    console.info("[AvatarPool] GLB loaded, clips:", Object.keys(clips));
    this.instances.set(agentId, scene);
    return { scene, mixer, clips };
  }

  releaseInstance(agentId: string): void {
    const mesh = this.instances.get(agentId);
    if (!mesh) return;
    mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
    this.instances.delete(agentId);
  }

  getFallbackMesh(role: string): THREE.Group {
    const rc = getRoleConfig(role);
    const color = new THREE.Color(rc.color);
    const group = new THREE.Group();

    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.7, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(rc.emissive), emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.2, 16, 12);
    const headMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(rc.emissive), emissiveIntensity: 0.4 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.25;
    group.add(head);

    return group;
  }
}
