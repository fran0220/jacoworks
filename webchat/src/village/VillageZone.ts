export type VillageZoneId =
  | "hq"
  | "watchtower"
  | "market"
  | "library"
  | "campfire"
  | "plaza"
  | "docks"
  | "crops";

export interface VillagePoint {
  x: number;
  y: number;
}

export interface VillageZone {
  id: VillageZoneId;
  label: string;
  caption: string;
  icon: string;
  anchor: VillagePoint;
  slots: VillagePoint[];
}

const point = (x: number, y: number): VillagePoint => ({ x, y });

export const VILLAGE_BASE_SIZE = {
  width: 5500,
  height: 3500,
  aspectRatio: 5500 / 3500,
} as const;

export const VILLAGE_ZONES: Record<VillageZoneId, VillageZone> = {
  hq: {
    id: "hq",
    label: "大宅总部",
    caption: "Leader / Planner 调度中枢",
    icon: "🏛️",
    anchor: point(66.4, 38.8),
    slots: [point(61.5, 42.8), point(65.3, 44.1), point(69.2, 42.4)],
  },
  watchtower: {
    id: "watchtower",
    label: "石塔哨所",
    caption: "Reviewer / Patrol 高处巡视",
    icon: "🗼",
    anchor: point(80.6, 23.1),
    slots: [point(77.5, 29.3), point(81.2, 30.1), point(84.4, 28.7)],
  },
  market: {
    id: "market",
    label: "集市工坊",
    caption: "Executor / Coder 忙碌作业区",
    icon: "⚒️",
    anchor: point(72.4, 31.6),
    slots: [
      point(67.5, 34.6),
      point(71.2, 35.5),
      point(74.9, 35.2),
      point(78.4, 34.1),
      point(75.1, 30.7),
    ],
  },
  library: {
    id: "library",
    label: "农舍书屋",
    caption: "Research / Writing 慢火沉浸区",
    icon: "📚",
    anchor: point(22.8, 24.8),
    slots: [point(18.1, 31.4), point(22.1, 32.6), point(26.4, 31.2), point(28.8, 27.6)],
  },
  campfire: {
    id: "campfire",
    label: "营火空地",
    caption: "闲时集合、恢复体力",
    icon: "🔥",
    anchor: point(58.1, 73.6),
    slots: [
      point(52.4, 76.3),
      point(56.1, 77.7),
      point(60.1, 77.4),
      point(63.9, 75.5),
      point(58.5, 72.2),
      point(54.7, 72.9),
    ],
  },
  plaza: {
    id: "plaza",
    label: "中央广场",
    caption: "任务交接与成果汇报",
    icon: "⛲",
    anchor: point(56.1, 52.4),
    slots: [point(51.8, 54.9), point(55.3, 56.2), point(58.9, 55.5), point(62.1, 53.7)],
  },
  docks: {
    id: "docks",
    label: "南岸码头",
    caption: "输入与交付的航运门口",
    icon: "⚓",
    anchor: point(24.7, 83.7),
    slots: [point(20.2, 84.1), point(24.4, 85.4), point(28.5, 84.2)],
  },
  crops: {
    id: "crops",
    label: "农田进度带",
    caption: "任务发芽、生长与成熟",
    icon: "🌾",
    anchor: point(16.9, 34.8),
    slots: [point(12.9, 35.2), point(16.7, 36.7), point(20.6, 35.4)],
  },
};

const ROLE_ALIASES: Record<string, string> = {
  leader: "planner",
  coder: "executor",
  builder: "executor",
  "crew-planner": "planner",
  "crew-worker": "executor",
  "crew-reviewer": "reviewer",
  analyst: "researcher",
  designer: "executor",
  secretary: "planner",
  summarizer: "writer",
  reviewer: "reviewer",
  patrol: "patrol",
  researcher: "researcher",
  writer: "writer",
  planner: "planner",
  executor: "executor",
  member: "member",
  default: "planner",
};

const HOME_ZONE_BY_ROLE: Record<string, VillageZoneId> = {
  planner: "hq",
  executor: "market",
  reviewer: "watchtower",
  patrol: "watchtower",
  researcher: "library",
  writer: "library",
  member: "market",
  default: "hq",
};

export function normalizeVillageRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  return ROLE_ALIASES[normalized] ?? (normalized || "member");
}

export function getVillageZone(zoneId: VillageZoneId): VillageZone {
  return VILLAGE_ZONES[zoneId];
}

export function getVillageHomeZone(role: string): VillageZoneId {
  const normalized = normalizeVillageRole(role);
  return HOME_ZONE_BY_ROLE[normalized] ?? "market";
}

export function getVillageIdleZone(): VillageZoneId {
  return "campfire";
}

export function resolveVillageZoneForPath(path: string): VillageZoneId {
  const normalized = path.trim().toLowerCase();

  if (!normalized) return "market";
  if (/\b(tasks?|sub-?tasks?|dependencies|wave|kanban|backlog|milestone)\b/.test(normalized)) {
    return "crops";
  }
  if (/\b(docs?|readme|prompt|notes?|spec|summary|report|proposal)\b/.test(normalized)) {
    return "library";
  }
  if (/\b(test|tests|qa|review|lint|assert|snapshot|guard)\b/.test(normalized)) {
    return "watchtower";
  }
  if (/\b(config|workflow|crew|messenger|registry|settings|ops|plan)\b/.test(normalized)) {
    return "hq";
  }
  if (/\b(dist|build|release|deploy|artifact|output|bundle|ship)\b/.test(normalized)) {
    return "docks";
  }
  if (/\b(public|static|asset|assets|sprite|image|images|video|audio|design)\b/.test(normalized)) {
    return "plaza";
  }
  return "market";
}

export function getVillageSlot(
  zoneId: VillageZoneId,
  slotIndex = 0,
): VillagePoint {
  const zone = getVillageZone(zoneId);
  return zone.slots[slotIndex % zone.slots.length] ?? zone.anchor;
}
