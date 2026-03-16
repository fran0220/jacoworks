import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer, EffectPass, RenderPass, BloomEffect } from "postprocessing";
import { WORLD } from "../types";

export class ObservatoryScene {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private clock = new THREE.Clock();
  private animationId = 0;
  private onUpdate: ((delta: number) => void) | null = null;

  constructor() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050f);
    this.scene.fog = new THREE.FogExp2(0x080816, 0.008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.camera.position.set(WORLD.CAMERA_DEFAULT.x, WORLD.CAMERA_DEFAULT.y, WORLD.CAMERA_DEFAULT.z);
    this.camera.lookAt(WORLD.CAMERA_LOOK_AT.x, WORLD.CAMERA_LOOK_AT.y, WORLD.CAMERA_LOOK_AT.z);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.target.set(WORLD.CAMERA_LOOK_AT.x, WORLD.CAMERA_LOOK_AT.y, WORLD.CAMERA_LOOK_AT.z);

    // Lighting
    const dirLight = new THREE.DirectionalLight(0xc8d8ff, 0.4);
    dirLight.position.set(20, 40, 20);
    this.scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0x0a0a20, 0.25);
    this.scene.add(ambientLight);

    const zoneColors = [0x3b82f6, 0xf97316, 0x22c55e, 0xffe4b5, 0x06b6d4, 0xa855f7];
    const zoneLightPositions = [
      [-18, 8, -42], [-40, 8, 22], [38, 8, -18], [22, 8, 45], [0, 8, 0], [30, 8, 0]
    ];
    for (let i = 0; i < zoneColors.length; i++) {
      const pl = new THREE.PointLight(zoneColors[i], 0.8, 60);
      pl.position.set(zoneLightPositions[i][0], zoneLightPositions[i][1], zoneLightPositions[i][2]);
      this.scene.add(pl);
    }

    // Post-processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new BloomEffect({
      intensity: 3.0,
      luminanceThreshold: 0.1,
      luminanceSmoothing: 0.5,
    });
    this.composer.addPass(new EffectPass(this.camera, bloom));
  }

  mount(container: HTMLElement) {
    const { clientWidth: w, clientHeight: h } = container;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.clock.start();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  resize() {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const { clientWidth: w, clientHeight: h } = parent;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  setOnUpdate(cb: (delta: number) => void) {
    this.onUpdate = cb;
  }

  private loop = () => {
    this.animationId = requestAnimationFrame(this.loop);
    const delta = this.clock.getDelta();
    this.controls.update();
    this.onUpdate?.(delta);
    this.composer.render(delta);
  };
}
