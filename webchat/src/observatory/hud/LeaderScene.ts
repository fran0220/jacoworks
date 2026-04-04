import * as THREE from "three";
import { AvatarPool } from "../avatar/AvatarPool";
import { AvatarAnimator } from "../avatar/AvatarAnimator";

export class LeaderScene {
  private static readonly FRAME_HEIGHT_FILL = 0.78;
  private static readonly FRAME_WIDTH_FILL = 0.72;

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private container: HTMLElement | null = null;
  private rafId: number | null = null;
  private clock = new THREE.Clock();
  private animator: AvatarAnimator | null = null;
  private modelRoot: THREE.Object3D | null = null;
  private readonly frameTarget = new THREE.Vector3(0, 0.8, 0);

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera = new THREE.PerspectiveCamera(25, 1, 0.1, 20);
    this.camera.position.set(0, 1.0, 3.0);
    this.camera.lookAt(this.frameTarget);

    this.scene = new THREE.Scene();

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
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot = null;
      this.animator = null;
    }

    let root: THREE.Object3D;
    let clips: Record<string, THREE.AnimationClip> | undefined;

    // Try GLB avatar from API
    try {
      const { fetchAvatar } = await import("../../lib/avatars");
      const profile = await fetchAvatar(role);
      if (profile && profile.model_url) {
        console.info("[LeaderScene] Loading GLB for role:", role);
        const glb = await pool.loadGLBAvatar("__leader__", profile.model_url, profile.anim_urls);
        root = glb.scene;
        clips = glb.clips;
        console.info("[LeaderScene] GLB loaded, clips:", Object.keys(clips));
      } else {
        console.info("[LeaderScene] No avatar profile for role:", role, "→ fallback");
        root = pool.getFallbackMesh(role);
      }
    } catch (err) {
      console.error("[LeaderScene] GLB load failed:", err);
      root = pool.getFallbackMesh(role);
    }

    // Fit the avatar to the portrait panel instead of assuming a fixed world height.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (size.x > 0 && size.y > 0) {
      const distance = this.camera.position.distanceTo(this.frameTarget);
      const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const viewWidth = viewHeight * this.camera.aspect;
      const scale = Math.min(
        (viewHeight * LeaderScene.FRAME_HEIGHT_FILL) / size.y,
        (viewWidth * LeaderScene.FRAME_WIDTH_FILL) / size.x,
      );

      root.scale.setScalar(scale);
      root.position.set(
        this.frameTarget.x - center.x * scale,
        this.frameTarget.y - center.y * scale,
        this.frameTarget.z - center.z * scale,
      );
    }

    this.modelRoot = root;
    this.scene.add(root);
    this.animator = new AvatarAnimator(root, clips);
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
