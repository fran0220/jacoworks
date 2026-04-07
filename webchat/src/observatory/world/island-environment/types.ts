export interface ZoneDef {
  pos: [number, number];
  style: "plaza" | "office" | "tech" | "admin" | "garden";
}

export interface TwinkleStar {
  baseSize: number;
  phase: number;
  speed: number;
}

export interface ParticleData {
  baseY: number;
  phase: number;
  speed: number;
}

export interface BuildingInstance {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface RoadParticle {
  roadIdx: number;
  progress: number;
  speed: number;
}

export interface RoadEndpoint {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}
