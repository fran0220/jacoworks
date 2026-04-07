import * as THREE from "three";
import type { CityWater } from "./osm-loader";

const WATER_Y = 0.05;

const waterVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPosition = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const waterFrag = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

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
    vec2 uv1 = vWorldPosition.xz * 0.3 + uTime * 0.04;
    vec2 uv2 = vWorldPosition.xz * 0.7 - uTime * 0.025;
    float n = noise(uv1) * 0.6 + noise(uv2) * 0.4;

    vec3 baseColor = vec3(0.016, 0.063, 0.145);
    vec3 highlight = vec3(0.024, 0.714, 0.831);
    float shimmer = smoothstep(0.55, 0.75, n);
    vec3 color = mix(baseColor, highlight, shimmer * 0.4);

    vec2 center = vec2(0.5);
    float dist = length(vUv - center);
    float edgeFade = 1.0 - smoothstep(0.3, 0.5, dist);

    gl_FragColor = vec4(color, 0.7 * edgeFade);
  }
`;

function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** 创建水体 Mesh */
export function createWaterMeshes(
  waterBodies: CityWater[],
  scene: THREE.Scene,
): THREE.ShaderMaterial[] {
  const materials: THREE.ShaderMaterial[] = [];

  for (const body of waterBodies) {
    const pointCount = body.polygon.length / 2;
    if (pointCount < 3) continue;

    const shape = new THREE.Shape();
    shape.moveTo(body.polygon[0], body.polygon[1]);
    for (let i = 1; i < pointCount; i++) {
      shape.lineTo(body.polygon[i * 2], body.polygon[i * 2 + 1]);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);

    const mat = createWaterMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = WATER_Y;
    scene.add(mesh);
    materials.push(mat);
  }

  return materials;
}
