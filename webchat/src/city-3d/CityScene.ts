import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createRenderPipeline, type RenderPipeline } from "./fx/render-pipeline";

const ZONE_LIGHTS: Record<string, { color: number; position: [number, number, number] }> = {
  city_hall:         { color: 0x3b82f6, position: [0, 15, 0] },
  innovation_center: { color: 0x06b6d4, position: [30, 15, -55] },
  data_hub:          { color: 0x22c55e, position: [107, 15, 55] },
  esports_center:    { color: 0xf97316, position: [436, 15, 300] },
  robotics_park:     { color: 0xef4444, position: [192, 15, -66] },
  tongming_lake:     { color: 0x8b5cf6, position: [-107, 15, -100] },
  logistics_port:    { color: 0xeab308, position: [276, 15, 144] },
  eco_garden:        { color: 0x10b981, position: [-46, 15, 111] },
};

export class CityScene {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private controls: OrbitControls;
  private pipeline: RenderPipeline;
  private clock = new THREE.Clock();
  private animationId = 0;
  private onUpdate: ((delta: number, elapsed: number) => void) | null = null;

  // flyToPosition state
  private flyStart: THREE.Vector3 | null = null;
  private flyEnd: THREE.Vector3 | null = null;
  private flyDuration = 0;
  private flyElapsed = 0;

  constructor() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020817);
    this.scene.fog = new THREE.FogExp2(0x020817, 0.0015);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
    this.camera.position.set(0, 180, 250);
    this.camera.lookAt(0, 0, -50);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 600;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.target.set(0, 0, -50);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.15;

    // Lighting
    const dirLight = new THREE.DirectionalLight(0x8899cc, 0.3);
    dirLight.position.set(100, 200, 100);
    this.scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0x0a0a1a, 0.2);
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x1a1a3e, 0x080810, 0.15);
    this.scene.add(hemiLight);

    // Zone point lights
    for (const zone of Object.values(ZONE_LIGHTS)) {
      const pl = new THREE.PointLight(zone.color, 0.6, 120);
      pl.position.set(...zone.position);
      this.scene.add(pl);
    }

    // Post-processing pipeline
    this.pipeline = createRenderPipeline(this.renderer, this.scene, this.camera);
  }

  mount(container: HTMLElement): void {
    const { clientWidth: w, clientHeight: h } = container;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.composer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.clock.start();
    this.loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.controls.dispose();
    this.pipeline.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const { clientWidth: w, clientHeight: h } = parent;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.composer.setSize(w, h);
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  setOnUpdate(cb: (delta: number, elapsed: number) => void): void {
    this.onUpdate = cb;
  }

  flyToPosition(target: THREE.Vector3, duration = 1.5): void {
    this.flyStart = this.camera.position.clone();
    this.flyEnd = target;
    this.flyDuration = duration;
    this.flyElapsed = 0;
  }

  setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
  }

  private loop = (): void => {
    this.animationId = requestAnimationFrame(this.loop);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Camera fly animation
    if (this.flyStart && this.flyEnd) {
      this.flyElapsed += delta;
      const t = Math.min(this.flyElapsed / this.flyDuration, 1);
      // Smooth-step easing
      const ease = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.flyStart, this.flyEnd, ease);
      if (t >= 1) {
        this.flyStart = null;
        this.flyEnd = null;
      }
    }

    this.controls.update();
    this.onUpdate?.(delta, elapsed);
    this.pipeline.composer.render(delta);
  };
}
