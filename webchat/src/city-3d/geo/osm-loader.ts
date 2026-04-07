export interface CityChunk {
  chunkId: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  heights: number[];
  buildingCount: number;
}

export interface CityRoad {
  type: string;
  width: number;
  points: Float32Array;
}

export interface CityWater {
  name: string;
  polygon: Float32Array;
}

export interface CityZoneData {
  id: string;
  label: string;
  center: [number, number];
  radius: number;
}

export interface CityData {
  center: [number, number];
  scale: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: { chunks: CityChunk[] };
  roads: CityRoad[];
  water: CityWater[];
  zones: CityZoneData[];
}

interface RawChunk {
  chunkId: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  positions: number[];
  indices: number[];
  normals: number[];
  heights: number[];
  buildingCount: number;
}

interface RawRoad {
  type: string;
  width: number;
  points: number[];
}

interface RawWater {
  name: string;
  polygon: number[];
}

interface RawCityData {
  center: [number, number];
  scale: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: { chunks: RawChunk[] };
  roads: RawRoad[];
  water: RawWater[];
  zones: CityZoneData[];
}

/** 加载预处理的城市数据 */
export async function loadCityData(url: string): Promise<CityData> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load city data: ${resp.status}`);
  const raw: RawCityData = await resp.json();

  const chunks: CityChunk[] = raw.buildings.chunks.map((c) => ({
    chunkId: c.chunkId,
    bounds: c.bounds,
    positions: new Float32Array(c.positions),
    indices: new Uint32Array(c.indices),
    normals: new Float32Array(c.normals),
    heights: c.heights,
    buildingCount: c.buildingCount,
  }));

  const roads: CityRoad[] = raw.roads.map((r) => ({
    type: r.type,
    width: r.width,
    points: new Float32Array(r.points),
  }));

  const water: CityWater[] = raw.water.map((w) => ({
    name: w.name,
    polygon: new Float32Array(w.polygon),
  }));

  return {
    center: raw.center,
    scale: raw.scale,
    bounds: raw.bounds,
    buildings: { chunks },
    roads,
    water,
    zones: raw.zones,
  };
}
