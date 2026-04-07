import * as THREE from "three";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  BloomEffect,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
} from "postprocessing";

export interface RenderPipeline {
  composer: EffectComposer;
  bloom: BloomEffect;
  dispose(): void;
}

export function createRenderPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): RenderPipeline {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 2.5,
    luminanceThreshold: 0.12,
    luminanceSmoothing: 0.4,
    mipmapBlur: true,
  });

  const vignette = new VignetteEffect({
    darkness: 0.45,
    offset: 0.3,
  });

  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

  composer.addPass(new EffectPass(camera, bloom));
  composer.addPass(new EffectPass(camera, vignette, smaa));

  return {
    composer,
    bloom,
    dispose() {
      composer.dispose();
    },
  };
}
