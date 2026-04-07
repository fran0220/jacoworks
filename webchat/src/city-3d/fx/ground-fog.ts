import * as THREE from "three";

/** 创建城市地面雾效果 (adapted from Observatory) */
export function createGroundFog(scene: THREE.Scene): THREE.ShaderMaterial {
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
      vec2 uv = vUv * 12.0 + uTime * 0.02;
      float n = noise(uv) * 0.5 + noise(uv * 2.0) * 0.3 + noise(uv * 4.0) * 0.2;
      float alpha = falloff * n * 0.04;
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

  const fogPlane = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), fogMat);
  fogPlane.rotation.x = -Math.PI / 2;
  fogPlane.position.y = 0.4;
  scene.add(fogPlane);

  return fogMat;
}
