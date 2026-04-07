#!/usr/bin/env node
/**
 * preprocess-osm.mjs — 从 Overpass API 拉取北京亦庄 OSM 数据，
 * 预处理为运行时可用的静态 JSON (CityData 格式)。
 *
 * Usage:
 *   node scripts/preprocess-osm.mjs                    # 拉取真实 OSM 数据
 *   node scripts/preprocess-osm.mjs --output out.json   # 指定输出路径
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 常量 ────────────────────────────────────────────────
const CENTER_LNG = 116.506;
const CENTER_LAT = 39.795;
const SCALE = 10000;
const CHUNK_SIZE = 250; // meters

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = "39.76,116.46,39.82,116.58"; // south,west,north,east

const ROAD_WIDTHS = {
  motorway: 15, trunk: 12, primary: 10, secondary: 8,
  tertiary: 6, residential: 4, service: 3, unclassified: 4,
};

const DEFAULT_HEIGHTS_BY_TYPE = {
  commercial: 18, office: 25, industrial: 12, residential: 15,
  retail: 8, apartments: 20, house: 8, garage: 4,
  school: 10, university: 14, hospital: 16, church: 12,
  yes: 12, // generic
};

// ── 投影 ────────────────────────────────────────────────
const COS_LAT = Math.cos(CENTER_LAT * Math.PI / 180);

function lngLatToLocal(lng, lat) {
  const x = (lng - CENTER_LNG) * SCALE * COS_LAT;
  const z = -(lat - CENTER_LAT) * SCALE;
  return [x, z];
}

// ── Overpass 查询 ────────────────────────────────────────
function buildQuery() {
  return `
[out:json][timeout:120][bbox:${BBOX}];
(
  way["building"];
  relation["building"];
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service|unclassified)$"];
  way["natural"="water"];
  relation["natural"="water"];
  way["waterway"="riverbank"];
  way["leisure"="park"]["name"];
);
out body;
>;
out skel qt;
`.trim();
}

async function fetchOverpass() {
  console.log("⏳ Fetching from Overpass API...");
  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(buildQuery())}`,
  });
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();
  console.log(`✅ Got ${data.elements.length} elements`);
  return data.elements;
}

// ── 解析 OSM elements ────────────────────────────────────
function parseElements(elements) {
  const nodes = new Map();
  const ways = [];
  const relations = [];

  for (const el of elements) {
    if (el.type === "node") {
      nodes.set(el.id, [el.lon, el.lat]);
    } else if (el.type === "way") {
      ways.push(el);
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }

  return { nodes, ways, relations };
}

function resolveWayCoords(way, nodes) {
  const coords = [];
  for (const nid of way.nodes || []) {
    const c = nodes.get(nid);
    if (c) coords.push(c);
  }
  return coords;
}

// ── 建筑高度 ─────────────────────────────────────────────
function getHeight(tags) {
  if (tags?.height) {
    const h = parseFloat(tags.height);
    if (!isNaN(h) && h > 0) return h;
  }
  if (tags?.["building:levels"]) {
    const levels = parseInt(tags["building:levels"], 10);
    if (!isNaN(levels) && levels > 0) return levels * 3.2;
  }
  const btype = tags?.building || "yes";
  if (DEFAULT_HEIGHTS_BY_TYPE[btype]) return DEFAULT_HEIGHTS_BY_TYPE[btype];
  // 随机 8-25m (确定性 seed 基于标签)
  const seed = (btype.charCodeAt(0) || 0) + (tags?.name?.length || 0);
  return 8 + (seed * 7 + 3) % 18;
}

// ── 确保 polygon 闭合 ────────────────────────────────────
function ensureClosed(coords) {
  if (coords.length < 3) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coords.push([...first]);
  }
  if (coords.length < 4) return null; // need 3 unique + closing
  return coords;
}

// ── Extrude 矩形/多边形建筑 ─────────────────────────────
function extrudeBuilding(localCoords, height) {
  // localCoords: [[x, z], ...] 已闭合 (最后一点 == 第一点)
  const n = localCoords.length - 1; // 去掉闭合重复点
  if (n < 3) return null;

  const positions = [];
  const normals = [];
  const indices = [];
  let vi = 0;

  // ─ 顶面 (y = height) ─
  // Simple fan triangulation from vertex 0
  for (let i = 0; i < n; i++) {
    positions.push(localCoords[i][0], height, localCoords[i][1]);
    normals.push(0, 1, 0);
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(vi, vi + i, vi + i + 1);
  }
  vi += n;

  // ─ 底面 (y = 0) ─
  for (let i = 0; i < n; i++) {
    positions.push(localCoords[i][0], 0, localCoords[i][1]);
    normals.push(0, -1, 0);
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(vi, vi + i + 1, vi + i); // reversed winding
  }
  vi += n;

  // ─ 侧面 ─
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const x0 = localCoords[i][0], z0 = localCoords[i][1];
    const x1 = localCoords[i2][0], z1 = localCoords[i2][1];

    // 法线 = 边的外法线 (2D: perpendicular)
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dz / len;
    const nz = -dx / len;

    // 4 个顶点: bottom-left, bottom-right, top-right, top-left
    positions.push(x0, 0, z0);       normals.push(nx, 0, nz);
    positions.push(x1, 0, z1);       normals.push(nx, 0, nz);
    positions.push(x1, height, z1);  normals.push(nx, 0, nz);
    positions.push(x0, height, z0);  normals.push(nx, 0, nz);

    indices.push(vi, vi + 1, vi + 2);
    indices.push(vi, vi + 2, vi + 3);
    vi += 4;
  }

  return { positions, normals, indices };
}

// ── Chunk 网格 ───────────────────────────────────────────
function chunkKey(x, z) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  return `chunk_${cx}_${cz}`;
}

function buildChunks(buildings) {
  const chunkMap = new Map();

  for (const bld of buildings) {
    // 建筑中心
    const sumX = bld.localCoords.reduce((s, c) => s + c[0], 0) / bld.localCoords.length;
    const sumZ = bld.localCoords.reduce((s, c) => s + c[1], 0) / bld.localCoords.length;
    const key = chunkKey(sumX, sumZ);

    if (!chunkMap.has(key)) {
      chunkMap.set(key, { buildings: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    }
    const chunk = chunkMap.get(key);
    chunk.buildings.push(bld);
    for (const [x, z] of bld.localCoords) {
      if (x < chunk.minX) chunk.minX = x;
      if (x > chunk.maxX) chunk.maxX = x;
      if (z < chunk.minZ) chunk.minZ = z;
      if (z > chunk.maxZ) chunk.maxZ = z;
    }
  }

  const chunks = [];
  for (const [chunkId, chunk] of chunkMap) {
    const allPositions = [];
    const allNormals = [];
    const allIndices = [];
    const heights = [];
    let vertexOffset = 0;

    for (const bld of chunk.buildings) {
      const geo = extrudeBuilding(bld.localCoords, bld.height);
      if (!geo) continue;

      allPositions.push(...geo.positions);
      allNormals.push(...geo.normals);
      for (const idx of geo.indices) {
        allIndices.push(idx + vertexOffset);
      }
      vertexOffset += geo.positions.length / 3;
      heights.push(bld.height);
    }

    if (allPositions.length === 0) continue;

    chunks.push({
      chunkId,
      bounds: {
        minX: Math.round(chunk.minX * 100) / 100,
        maxX: Math.round(chunk.maxX * 100) / 100,
        minZ: Math.round(chunk.minZ * 100) / 100,
        maxZ: Math.round(chunk.maxZ * 100) / 100,
      },
      positions: allPositions.map(v => Math.round(v * 100) / 100),
      indices: allIndices,
      normals: allNormals.map(v => Math.round(v * 1000) / 1000),
      heights: heights.map(v => Math.round(v * 10) / 10),
      buildingCount: heights.length,
    });
  }

  return chunks;
}

// ── 道路处理 ──────────────────────────────────────────────
function processRoads(ways, nodes) {
  const roads = [];
  for (const way of ways) {
    const tags = way.tags || {};
    const highway = tags.highway;
    if (!highway) continue;
    const type = ROAD_WIDTHS[highway] ? highway : "residential";
    const coords = resolveWayCoords(way, nodes);
    if (coords.length < 2) continue;

    const points = [];
    for (const [lng, lat] of coords) {
      const [x, z] = lngLatToLocal(lng, lat);
      points.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    }

    roads.push({
      type,
      width: ROAD_WIDTHS[type] || 4,
      points,
    });
  }
  return roads;
}

// ── 水体处理 ──────────────────────────────────────────────
function processWater(ways, nodes) {
  const waterBodies = [];
  for (const way of ways) {
    const tags = way.tags || {};
    if (tags.natural !== "water" && tags.waterway !== "riverbank") continue;
    const coords = resolveWayCoords(way, nodes);
    if (coords.length < 3) continue;

    const polygon = [];
    for (const [lng, lat] of coords) {
      const [x, z] = lngLatToLocal(lng, lat);
      polygon.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    }

    waterBodies.push({
      name: tags.name || "water",
      polygon,
    });
  }
  return waterBodies;
}

// ── 功能区 ───────────────────────────────────────────────
const ZONES = [
  { id: "city_hall",         label: "亦庄中枢",       lng: 116.506, lat: 39.795, radius: 300 },
  { id: "innovation_center", label: "科创中心",       lng: 116.51,  lat: 39.8,   radius: 250 },
  { id: "data_hub",          label: "数据中枢",       lng: 116.52,  lat: 39.79,  radius: 250 },
  { id: "esports_center",    label: "智慧电竞中心",   lng: 116.563, lat: 39.768, radius: 200 },
  { id: "robotics_park",     label: "机器人产业园",   lng: 116.531, lat: 39.801, radius: 250 },
  { id: "tongming_lake",     label: "通明湖",         lng: 116.492, lat: 39.804, radius: 350 },
  { id: "logistics_port",    label: "物流港",         lng: 116.542, lat: 39.782, radius: 200 },
  { id: "eco_garden",        label: "生态花园",       lng: 116.5,   lat: 39.785, radius: 300 },
];

function buildZones() {
  return ZONES.map(z => {
    const [x, zz] = lngLatToLocal(z.lng, z.lat);
    return {
      id: z.id,
      label: z.label,
      center: [Math.round(x * 100) / 100, Math.round(zz * 100) / 100],
      radius: z.radius,
    };
  });
}

// ── 主流程 ───────────────────────────────────────────────
async function main() {
  const outputArg = process.argv.indexOf("--output");
  const outputPath = outputArg >= 0 && process.argv[outputArg + 1]
    ? resolve(process.argv[outputArg + 1])
    : resolve(__dirname, "../webchat/public/city-data/yizhuang.json");

  let elements;
  try {
    elements = await fetchOverpass();
  } catch (err) {
    console.error(`❌ Overpass fetch failed: ${err.message}`);
    console.error("   Hint: generate synthetic data with a separate script instead.");
    process.exit(1);
  }

  const { nodes, ways } = parseElements(elements);

  // ── 建筑 ──
  console.log("🏗️  Processing buildings...");
  const buildings = [];
  for (const way of ways) {
    const tags = way.tags || {};
    if (!tags.building) continue;
    const coords = resolveWayCoords(way, nodes);
    const closed = ensureClosed(coords);
    if (!closed) continue;

    const localCoords = closed.map(([lng, lat]) => lngLatToLocal(lng, lat));
    buildings.push({
      localCoords,
      height: getHeight(tags),
    });
  }
  console.log(`   ${buildings.length} buildings`);

  const chunks = buildChunks(buildings);
  console.log(`   ${chunks.length} chunks`);

  // ── 道路 ──
  console.log("🛣️  Processing roads...");
  const roadWays = ways.filter(w => w.tags?.highway);
  const roads = processRoads(roadWays, nodes);
  console.log(`   ${roads.length} roads`);

  // ── 水体 ──
  console.log("💧 Processing water...");
  const water = processWater(ways, nodes);
  console.log(`   ${water.length} water bodies`);

  // ── Bounds ──
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const ch of chunks) {
    if (ch.bounds.minX < minX) minX = ch.bounds.minX;
    if (ch.bounds.maxX > maxX) maxX = ch.bounds.maxX;
    if (ch.bounds.minZ < minZ) minZ = ch.bounds.minZ;
    if (ch.bounds.maxZ > maxZ) maxZ = ch.bounds.maxZ;
  }

  const cityData = {
    center: [CENTER_LNG, CENTER_LAT],
    scale: SCALE,
    bounds: {
      minX: Math.round(minX * 100) / 100,
      maxX: Math.round(maxX * 100) / 100,
      minZ: Math.round(minZ * 100) / 100,
      maxZ: Math.round(maxZ * 100) / 100,
    },
    buildings: { chunks },
    roads,
    water,
    zones: buildZones(),
  };

  writeFileSync(outputPath, JSON.stringify(cityData), "utf-8");
  const sizeMB = (Buffer.byteLength(JSON.stringify(cityData)) / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Written to ${outputPath} (${sizeMB} MB)`);
  console.log(`   Buildings: ${buildings.length} in ${chunks.length} chunks`);
  console.log(`   Roads: ${roads.length}`);
  console.log(`   Water: ${water.length}`);
  console.log(`   Zones: ${cityData.zones.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
