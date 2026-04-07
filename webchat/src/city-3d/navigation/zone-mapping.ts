import * as THREE from "three";

export type CityZoneId =
  | "city_hall"
  | "innovation_center"
  | "data_hub"
  | "esports_center"
  | "robotics_park"
  | "tongming_lake"
  | "logistics_port"
  | "eco_garden";

export interface CityZone3D {
  id: CityZoneId;
  label: string;
  caption: string;
  center: THREE.Vector3;
  radius: number;
  color: number;
  emissive: number;
  slots: THREE.Vector3[];
}

const Y = 0.15;

function hashZoneId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return h;
}

function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1; // -1..1
  };
}

function makeSlots(cx: number, cz: number, count: number, zoneId: string): THREE.Vector3[] {
  const rng = seededRandom(hashZoneId(zoneId));
  const slots: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const dx = rng() * 7 + (rng() > 0 ? 8 : -8);
    const dz = rng() * 7 + (rng() > 0 ? 8 : -8);
    slots.push(new THREE.Vector3(cx + dx, Y, cz + dz));
  }
  return slots;
}

interface ZoneDef {
  id: CityZoneId;
  label: string;
  caption: string;
  cx: number;
  cz: number;
  radius: number;
  color: number;
  emissive: number;
  slotCount: number;
}

const ZONE_DEFS: ZoneDef[] = [
  { id: "city_hall",         label: "亦庄中枢",     caption: "Leader / Planner 调度甲板",     cx: 0,    cz: 0,    radius: 30, color: 0x3b82f6, emissive: 0x1d4ed8, slotCount: 3 },
  { id: "innovation_center", label: "科创中心",     caption: "策略拆解与方案孵化",             cx: 30,   cz: -55,  radius: 25, color: 0x06b6d4, emissive: 0x0e7490, slotCount: 3 },
  { id: "data_hub",          label: "数据中枢",     caption: "审阅巡检与指标观测",             cx: 107,  cz: 55,   radius: 25, color: 0x22c55e, emissive: 0x15803d, slotCount: 3 },
  { id: "esports_center",    label: "智慧电竞中心", caption: "现场执行与多人协同演算",         cx: 436,  cz: 300,  radius: 30, color: 0xf97316, emissive: 0xc2410c, slotCount: 4 },
  { id: "robotics_park",     label: "机器人产业园", caption: "工程实现与自动化工坊",           cx: 192,  cz: -66,  radius: 28, color: 0xef4444, emissive: 0xb91c1c, slotCount: 4 },
  { id: "tongming_lake",     label: "通明湖",       caption: "研究写作与长思考岸线",           cx: -107, cz: -100, radius: 35, color: 0x8b5cf6, emissive: 0x6d28d9, slotCount: 4 },
  { id: "logistics_port",    label: "物流港",       caption: "交付集结与成果出站口",           cx: 276,  cz: 144,  radius: 25, color: 0xeab308, emissive: 0xa16207, slotCount: 3 },
  { id: "eco_garden",        label: "生态花园",     caption: "空闲巡游与低压恢复区",           cx: -46,  cz: 111,  radius: 30, color: 0x10b981, emissive: 0x047857, slotCount: 6 },
];

const ZONES_3D: CityZone3D[] = ZONE_DEFS.map((d) => ({
  id: d.id,
  label: d.label,
  caption: d.caption,
  center: new THREE.Vector3(d.cx, Y, d.cz),
  radius: d.radius,
  color: d.color,
  emissive: d.emissive,
  slots: makeSlots(d.cx, d.cz, d.slotCount, d.id),
}));

const ZONE_MAP = new Map<CityZoneId, CityZone3D>(ZONES_3D.map((z) => [z.id, z]));

export function getCityZones3D(): CityZone3D[] {
  return ZONES_3D;
}

export function getZone3D(id: CityZoneId): CityZone3D {
  return ZONE_MAP.get(id)!;
}

const ROLE_ALIASES: Record<string, string> = {
  leader: "planner",
  coder: "executor",
  builder: "executor",
  analyst: "researcher",
  reviewer: "reviewer",
  patrol: "patrol",
  researcher: "researcher",
  writer: "writer",
  planner: "planner",
  executor: "executor",
  member: "member",
  default: "planner",
};

const HOME_ZONE_BY_ROLE: Record<string, CityZoneId> = {
  planner: "city_hall",
  executor: "robotics_park",
  reviewer: "data_hub",
  patrol: "data_hub",
  researcher: "tongming_lake",
  writer: "tongming_lake",
  member: "esports_center",
};

export function getRoleHomeZone(role: string): CityZoneId {
  const normalized = ROLE_ALIASES[role.trim().toLowerCase()] ?? role.trim().toLowerCase();
  return HOME_ZONE_BY_ROLE[normalized] ?? "esports_center";
}

export function getIdleZone(): CityZoneId {
  return "eco_garden";
}
