import * as THREE from "three";
import type { AvatarPool } from "../avatar/AvatarPool";
import { AvatarAnimator } from "../avatar/AvatarAnimator";

export class LeaderScene {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private container: HTMLElement | null = null;
  private rafId: number | null = null;
  private clock = new THREE.Clock();
  private animator: AvatarAnimator | null = null;
  private modelRoot: THREE.Object3D | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera = new THREE.PerspectiveCamera(25, 1, 0.1, 10);
    this.camera.position.set(0, 1.35, 1.8);
    this.camera.lookAt(0, 1.2, 0);

    this.scene = new THREE.Scene();

    // Lighting
    const dirLight = new THREE.DirectionalLight(0xc8d8ff, 2.0);
    dirLight.position.set(1, 2, 2);
    this.scene.add(dirLight);

    this.scene.add(new THREE.AmbientLight(0x1a1a3e, 0.8));

    const rimLight = new THREE.PointLight(0x00d4ff, 0.4, 6);
    rimLight.position.set(-1, 1.5, 1);
    this.scene.add(rimLight);
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.resize();
    this.clock.start();
    this.loop();
  }

  async loadLeader(pool: AvatarPool, role: string): Promise<void> {
    // Remove previous model if any
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot = null;
      this.animator = null;
    }

    const vrm = await pool.createInstance("__leader__", role);
    let root: THREE.Object3D;

    if (vrm) {
      root = vrm.scene;
      this.animator = new AvatarAnimator(vrm, root);
    } else {
      const fallback = pool.getFallbackMesh(role);
      root = fallback;
      this.animator = new AvatarAnimator(null, root);
    }

    this.modelRoot = root;
    this.scene.add(root);
  }

  getAnimator(): AvatarAnimator | null {
    return this.animator;
  }

  resize(): void {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  setVisible(visible: boolean): void {
    if (this.modelRoot) this.modelRoot.visible = visible;
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.renderer.dispose();
    if (this.container && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.container = null;
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const delta = this.clock.getDelta();
    if (this.animator) this.animator.update(delta);
    this.renderer.render(this.scene, this.camera);
  };
}
