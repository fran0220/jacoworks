#!/usr/bin/env node
/**
 * generate-yizhuang-data.mjs — 生成亦庄合成城市数据 (基于真实坐标)
 * 用于开发和演示，无需 Overpass API。
 *
 * Usage: node scripts/generate-yizhuang-data.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 常量 ────────────────────────────────────────────────
const CENTER_LNG = 116.506;
const CENTER_LAT = 39.795;
const SCALE = 10000;
const CHUNK_SIZE = 250;
const COS_LAT = Math.cos(CENTER_LAT * Math.PI / 180);

function lngLatToLocal(lng, lat) {
  const x = (lng - CENTER_LNG) * SCALE * COS_LAT;
  const z = -(lat - CENTER_LAT) * SCALE;
  return [x, z];
}

// ── 确定性伪随机 ─────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260407);
const randRange = (min, max) => min + rand() * (max - min);
const randInt = (min, max) => Math.floor(randRange(min, max + 1));

// ── 功能区定义 ───────────────────────────────────────────
const ZONES = [
  { id: "city_hall",         label: "亦庄中枢",     lng: 116.506, lat: 39.795, radius: 300, heightMin: 20, heightMax: 80, count: 180 },
  { id: "innovation_center", label: "科创中心",     lng: 116.51,  lat: 39.8,   radius: 250, heightMin: 8,  heightMax: 20, count: 200 },
  { id: "data_hub",          label: "数据中枢",     lng: 116.52,  lat: 39.79,  radius: 250, heightMin: 15, heightMax: 45, count: 180 },
  { id: "esports_center",    label: "智慧电竞中心", lng: 116.563, lat: 39.768, radius: 200, heightMin: 10, heightMax: 30, count: 120 },
  { id: "robotics_park",     label: "机器人产业园", lng: 116.531, lat: 39.801, radius: 250, heightMin: 8,  heightMax: 25, count: 180 },
  { id: "tongming_lake",     label: "通明湖",       lng: 116.492, lat: 39.804, radius: 350, heightMin: 5,  heightMax: 12, count: 100 },
  { id: "logistics_port",    label: "物流港",       lng: 116.542, lat: 39.782, radius: 200, heightMin: 8,  heightMax: 18, count: 150 },
  { id: "eco_garden",        label: "生态花园",     lng: 116.5,   lat: 39.785, radius: 300, heightMin: 5,  heightMax: 12, count: 120 },
];

// ── 建筑足迹生成 ─────────────────────────────────────────
function generateFootprint(cx, cz, widthX, widthZ, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = widthX / 2;
  const hd = widthZ / 2;

  // 基础矩形
  let corners = [
    [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd],
  ];

  // 有 30% 概率生成 L 形
  if (rand() < 0.3) {
    const cutX = hw * randRange(0.3, 0.6);
    const cutZ = hd * randRange(0.3, 0.6);
    corners = [
      [-hw, -hd], [hw, -hd], [hw, cutZ], [cutX, cutZ],
      [cutX, hd], [-hw, hd],
    ];
  }

  // 旋转 + 平移
  const result = corners.map(([lx, lz]) => {
    const rx = lx * cos - lz * sin + cx;
    const rz = lx * sin + lz * cos + cz;
    return [Math.round(rx * 100) / 100, Math.round(rz * 100) / 100];
  });

  // 闭合
  result.push([...result[0]]);
  return result;
}

// ── Extrude 建筑 ─────────────────────────────────────────
function extrudeBuilding(localCoords, height) {
  const n = localCoords.length - 1;
  if (n < 3) return null;

  const positions = [];
  const normals = [];
  const indices = [];
  let vi = 0;

  // 顶面
  for (let i = 0; i < n; i++) {
    positions.push(localCoords[i][0], height, localCoords[i][1]);
    normals.push(0, 1, 0);
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(vi, vi + i, vi + i + 1);
  }
  vi += n;

  // 底面
  for (let i = 0; i < n; i++) {
    positions.push(localCoords[i][0], 0, localCoords[i][1]);
    normals.push(0, -1, 0);
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(vi, vi + i + 1, vi + i);
  }
  vi += n;

  // 侧面
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const x0 = localCoords[i][0], z0 = localCoords[i][1];
    const x1 = localCoords[i2][0], z1 = localCoords[i2][1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dz / len;
    const nz = -dx / len;

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

// ── 生成建筑 ─────────────────────────────────────────────
function generateBuildings() {
  const allBuildings = [];

  for (const zone of ZONES) {
    const [cx, cz] = lngLatToLocal(zone.lng, zone.lat);

    for (let i = 0; i < zone.count; i++) {
      // 在区域 radius 内随机分布 (高斯近似分布，中心更密)
      const angle = rand() * Math.PI * 2;
      const dist = zone.radius * Math.sqrt(rand()) * 0.9;
      const bx = cx + Math.cos(angle) * dist;
      const bz = cz + Math.sin(angle) * dist;

      const widthX = randRange(10, 40);
      const widthZ = randRange(10, 40);
      const height = randRange(zone.heightMin, zone.heightMax);
      const rotation = rand() * Math.PI * 0.5; // 0-90° 对齐

      const footprint = generateFootprint(bx, bz, widthX, widthZ, rotation);
      allBuildings.push({ localCoords: footprint, height });
    }
  }

  // 填充建筑：在区域之间随机散布
  const fillCount = 270;
  for (let i = 0; i < fillCount; i++) {
    const lng = randRange(116.47, 116.56);
    const lat = randRange(39.77, 39.81);
    const [bx, bz] = lngLatToLocal(lng, lat);

    const widthX = randRange(8, 30);
    const widthZ = randRange(8, 30);
    const height = randRange(6, 20);
    const rotation = rand() * Math.PI * 0.5;

    const footprint = generateFootprint(bx, bz, widthX, widthZ, rotation);
    allBuildings.push({ localCoords: footprint, height });
  }

  return allBuildings;
}

// ── Chunk 切分 ───────────────────────────────────────────
function buildChunks(buildings) {
  const chunkMap = new Map();

  for (const bld of buildings) {
    const coords = bld.localCoords.slice(0, -1); // 去掉闭合点
    const sumX = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const sumZ = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const cx = Math.floor(sumX / CHUNK_SIZE);
    const cz = Math.floor(sumZ / CHUNK_SIZE);
    const key = `chunk_${cx}_${cz}`;

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
      const geo = extrudeBuilding(bld.localCoords, Math.round(bld.height * 10) / 10);
      if (!geo) continue;
      allPositions.push(...geo.positions);
      allNormals.push(...geo.normals);
      for (const idx of geo.indices) allIndices.push(idx + vertexOffset);
      vertexOffset += geo.positions.length / 3;
      heights.push(Math.round(bld.height * 10) / 10);
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
      heights,
      buildingCount: heights.length,
    });
  }

  return chunks;
}

// ── 生成道路 ─────────────────────────────────────────────
function generateRoads() {
  const roads = [];

  // 主干道：连接主要区域
  const mainRoutes = [
    // 横向主干道
    { type: "primary", width: 10, waypoints: [[116.47, 39.795], [116.49, 39.795], [116.506, 39.795], [116.52, 39.795], [116.54, 39.795], [116.56, 39.795]] },
    { type: "primary", width: 10, waypoints: [[116.47, 39.785], [116.50, 39.785], [116.52, 39.785], [116.542, 39.782], [116.56, 39.78]] },
    { type: "primary", width: 10, waypoints: [[116.48, 39.805], [116.50, 39.804], [116.52, 39.803], [116.54, 39.802], [116.56, 39.80]] },
    // 纵向主干道
    { type: "primary", width: 10, waypoints: [[116.506, 39.77], [116.506, 39.78], [116.506, 39.795], [116.506, 39.81]] },
    { type: "primary", width: 10, waypoints: [[116.52, 39.77], [116.52, 39.79], [116.52, 39.81]] },
    { type: "primary", width: 10, waypoints: [[116.54, 39.77], [116.54, 39.79], [116.54, 39.81]] },
    { type: "primary", width: 10, waypoints: [[116.49, 39.77], [116.492, 39.79], [116.492, 39.81]] },
  ];

  for (const route of mainRoutes) {
    const points = [];
    for (const [lng, lat] of route.waypoints) {
      const [x, z] = lngLatToLocal(lng, lat);
      points.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    }
    roads.push({ type: route.type, width: route.width, points });
  }

  // 次要道路：环路和连接线
  const secondaryRoutes = [
    { type: "secondary", width: 8, waypoints: [[116.50, 39.80], [116.51, 39.80], [116.52, 39.80], [116.531, 39.801]] },
    { type: "secondary", width: 8, waypoints: [[116.506, 39.795], [116.51, 39.80]] },
    { type: "secondary", width: 8, waypoints: [[116.52, 39.79], [116.531, 39.801]] },
    { type: "secondary", width: 8, waypoints: [[116.542, 39.782], [116.563, 39.768]] },
    { type: "secondary", width: 8, waypoints: [[116.492, 39.804], [116.50, 39.80]] },
    { type: "secondary", width: 8, waypoints: [[116.50, 39.785], [116.506, 39.795]] },
    { type: "secondary", width: 8, waypoints: [[116.531, 39.801], [116.54, 39.795]] },
  ];

  for (const route of secondaryRoutes) {
    const points = [];
    for (const [lng, lat] of route.waypoints) {
      const [x, z] = lngLatToLocal(lng, lat);
      points.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    }
    roads.push({ type: route.type, width: route.width, points });
  }

  // 居住区小路：在每个区域附近生成网格状小路
  for (const zone of ZONES) {
    if (zone.id === "tongming_lake") continue; // 湖区不需密集道路
    const [cx, cz] = lngLatToLocal(zone.lng, zone.lat);
    const r = zone.radius * 0.6;

    // 生成 3-5 条区域内小路
    const roadCount = randInt(3, 5);
    for (let i = 0; i < roadCount; i++) {
      const a1 = rand() * Math.PI * 2;
      const a2 = a1 + randRange(0.5, 2.0);
      const d1 = r * randRange(0.2, 0.9);
      const d2 = r * randRange(0.2, 0.9);

      const x1 = cx + Math.cos(a1) * d1;
      const z1 = cz + Math.sin(a1) * d1;
      const x2 = cx + Math.cos(a2) * d2;
      const z2 = cz + Math.sin(a2) * d2;

      roads.push({
        type: "residential",
        width: 4,
        points: [
          Math.round(x1 * 100) / 100, Math.round(z1 * 100) / 100,
          Math.round(cx * 100) / 100, Math.round(cz * 100) / 100,
          Math.round(x2 * 100) / 100, Math.round(z2 * 100) / 100,
        ],
      });
    }
  }

  return roads;
}

// ── 生成水体 ─────────────────────────────────────────────
function generateWater() {
  const [cx, cz] = lngLatToLocal(116.492, 39.804);
  const water = [];

  // 通明湖 — 不规则椭圆
  const lakePoints = [];
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const rx = 280 + Math.sin(angle * 3) * 40 + Math.cos(angle * 5) * 20;
    const rz = 200 + Math.cos(angle * 2) * 30 + Math.sin(angle * 4) * 15;
    const x = cx + Math.cos(angle) * rx;
    const z = cz + Math.sin(angle) * rz;
    lakePoints.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
  }
  water.push({ name: "通明湖", polygon: lakePoints });

  // 小型景观水系 — 生态花园旁
  const [px, pz] = lngLatToLocal(116.498, 39.783);
  const pondPoints = [];
  const pondSegs = 12;
  for (let i = 0; i < pondSegs; i++) {
    const angle = (i / pondSegs) * Math.PI * 2;
    const r = 60 + Math.sin(angle * 3) * 15;
    pondPoints.push(
      Math.round((px + Math.cos(angle) * r) * 100) / 100,
      Math.round((pz + Math.sin(angle) * r) * 100) / 100,
    );
  }
  water.push({ name: "花园池", polygon: pondPoints });

  return water;
}

// ── 主流程 ───────────────────────────────────────────────
function main() {
  console.log("🏙️  Generating Yizhuang synthetic city data...");

  // 建筑
  const buildings = generateBuildings();
  console.log(`   ${buildings.length} buildings generated`);

  const chunks = buildChunks(buildings);
  console.log(`   ${chunks.length} chunks`);

  // 道路
  const roads = generateRoads();
  console.log(`   ${roads.length} roads`);

  // 水体
  const water = generateWater();
  console.log(`   ${water.length} water bodies`);

  // 功能区
  const zones = ZONES.map(z => {
    const [x, zz] = lngLatToLocal(z.lng, z.lat);
    return {
      id: z.id,
      label: z.label,
      center: [Math.round(x * 100) / 100, Math.round(zz * 100) / 100],
      radius: z.radius,
    };
  });

  // Bounds
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
    zones,
  };

  // 验证
  let totalVerts = 0, totalIndices = 0, totalBuildings = 0;
  for (const ch of chunks) {
    totalVerts += ch.positions.length;
    totalIndices += ch.indices.length;
    totalBuildings += ch.buildingCount;

    if (ch.positions.length % 3 !== 0) {
      console.error(`❌ chunk ${ch.chunkId}: positions.length (${ch.positions.length}) not multiple of 3`);
      process.exit(1);
    }
    if (ch.indices.length % 3 !== 0) {
      console.error(`❌ chunk ${ch.chunkId}: indices.length (${ch.indices.length}) not multiple of 3`);
      process.exit(1);
    }
    if (ch.normals.length !== ch.positions.length) {
      console.error(`❌ chunk ${ch.chunkId}: normals.length (${ch.normals.length}) !== positions.length (${ch.positions.length})`);
      process.exit(1);
    }
  }

  console.log(`\n✅ Validation passed`);
  console.log(`   Total buildings: ${totalBuildings}`);
  console.log(`   Total vertices: ${totalVerts / 3}`);
  console.log(`   Total triangles: ${totalIndices / 3}`);

  const outputDir = resolve(__dirname, "../webchat/public/city-data");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "yizhuang.json");
  const json = JSON.stringify(cityData);
  writeFileSync(outputPath, json, "utf-8");

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(0);
  console.log(`\n📦 Written to ${outputPath}`);
  console.log(`   File size: ${sizeKB} KB (${sizeMB} MB)`);
  console.log(`   Buildings: ${totalBuildings} in ${chunks.length} chunks`);
  console.log(`   Roads: ${roads.length}`);
  console.log(`   Water: ${water.length}`);
  console.log(`   Zones: ${zones.length}`);
}

main();
