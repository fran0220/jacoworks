export type CityZoneId =
  | "city_hall"
  | "innovation_center"
  | "data_hub"
  | "esports_center"
  | "robotics_park"
  | "tongming_lake"
  | "logistics_port"
  | "eco_garden";

export interface CityPoint {
  lng: number;
  lat: number;
}

export interface CityZone {
  id: CityZoneId;
  label: string;
  caption: string;
  iconName: string;
  anchor: CityPoint;
  slots: CityPoint[];
}

const point = (lng: number, lat: number): CityPoint => ({ lng, lat });

const offsetPoint = (
  lng: number,
  lat: number,
  lngOffset: number,
  latOffset: number,
): CityPoint => point(lng + lngOffset, lat + latOffset);

export const YIZHUANG_CITY_CENTER = point(116.506, 39.795);

export const CITY_ZONES: Record<CityZoneId, CityZone> = {
  city_hall: {
    id: "city_hall",
    label: "亦庄中枢",
    caption: "Leader / Planner 调度甲板",
    iconName: "building-2",
    anchor: point(116.506, 39.795),
    slots: [
      offsetPoint(116.506, 39.795, -0.00022, -0.00014),
      offsetPoint(116.506, 39.795, 0, 0.0002),
      offsetPoint(116.506, 39.795, 0.00022, -0.00012),
    ],
  },
  innovation_center: {
    id: "innovation_center",
    label: "科创中心",
    caption: "策略拆解与方案孵化",
    iconName: "cpu",
    anchor: point(116.51, 39.8),
    slots: [
      offsetPoint(116.51, 39.8, -0.0002, 0.00016),
      offsetPoint(116.51, 39.8, 0.00018, 0.00014),
      offsetPoint(116.51, 39.8, 0.00012, -0.0002),
    ],
  },
  data_hub: {
    id: "data_hub",
    label: "数据中枢",
    caption: "审阅巡检与指标观测",
    iconName: "database",
    anchor: point(116.52, 39.79),
    slots: [
      offsetPoint(116.52, 39.79, -0.00018, 0.00018),
      offsetPoint(116.52, 39.79, 0.00018, 0.00018),
      offsetPoint(116.52, 39.79, 0, -0.00022),
    ],
  },
  esports_center: {
    id: "esports_center",
    label: "智慧电竞中心",
    caption: "现场执行与多人协同演算",
    iconName: "gamepad-2",
    anchor: point(116.563, 39.768),
    slots: [
      offsetPoint(116.563, 39.768, -0.00028, 0.0002),
      offsetPoint(116.563, 39.768, 0.00024, 0.00022),
      offsetPoint(116.563, 39.768, 0.00028, -0.00018),
      offsetPoint(116.563, 39.768, -0.00022, -0.00022),
    ],
  },
  robotics_park: {
    id: "robotics_park",
    label: "机器人产业园",
    caption: "工程实现与自动化工坊",
    iconName: "bot",
    anchor: point(116.531, 39.801),
    slots: [
      offsetPoint(116.531, 39.801, -0.00024, 0.00018),
      offsetPoint(116.531, 39.801, 0.0002, 0.00016),
      offsetPoint(116.531, 39.801, 0.00022, -0.00018),
      offsetPoint(116.531, 39.801, -0.00018, -0.0002),
    ],
  },
  tongming_lake: {
    id: "tongming_lake",
    label: "通明湖",
    caption: "研究写作与长思考岸线",
    iconName: "library-big",
    anchor: point(116.492, 39.804),
    slots: [
      offsetPoint(116.492, 39.804, -0.0002, 0.00014),
      offsetPoint(116.492, 39.804, 0, 0.00022),
      offsetPoint(116.492, 39.804, 0.00022, 0.00012),
      offsetPoint(116.492, 39.804, 0.00014, -0.00018),
    ],
  },
  logistics_port: {
    id: "logistics_port",
    label: "物流港",
    caption: "交付集结与成果出站口",
    iconName: "truck",
    anchor: point(116.542, 39.782),
    slots: [
      offsetPoint(116.542, 39.782, -0.00024, 0.00014),
      offsetPoint(116.542, 39.782, 0, 0.0002),
      offsetPoint(116.542, 39.782, 0.00022, 0.00012),
    ],
  },
  eco_garden: {
    id: "eco_garden",
    label: "生态花园",
    caption: "空闲巡游与低压恢复区",
    iconName: "trees",
    anchor: point(116.5, 39.785),
    slots: [
      offsetPoint(116.5, 39.785, -0.00028, 0.00016),
      offsetPoint(116.5, 39.785, -0.00008, 0.00024),
      offsetPoint(116.5, 39.785, 0.00014, 0.00022),
      offsetPoint(116.5, 39.785, 0.00026, 0.00004),
      offsetPoint(116.5, 39.785, 0.00018, -0.0002),
      offsetPoint(116.5, 39.785, -0.00014, -0.00022),
    ],
  },
};

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
  default: "city_hall",
};

export function normalizeCityRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  return ROLE_ALIASES[normalized] ?? (normalized || "member");
}

export function getCityZone(zoneId: CityZoneId): CityZone {
  return CITY_ZONES[zoneId];
}

export function getCityHomeZone(role: string): CityZoneId {
  const normalized = normalizeCityRole(role);
  return HOME_ZONE_BY_ROLE[normalized] ?? "esports_center";
}

export function getCityIdleZone(): CityZoneId {
  return "eco_garden";
}

export function getCitySlot(zoneId: CityZoneId, slotIndex = 0): CityPoint {
  const zone = getCityZone(zoneId);
  return zone.slots[slotIndex % zone.slots.length] ?? zone.anchor;
}
