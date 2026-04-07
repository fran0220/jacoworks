import { type LucideIcon, MoonStar, Sun, Sunrise, Sunset } from "lucide-react";
import { getLightPreset, type LightPreset } from "../../lib/sun-position";
import {
  mapVillageStateToExpression,
  type VillageAgentState,
} from "../../village/VillageAgent";
import type {
  CityAgentMarkerRecord,
  CityAgentModel,
  CityZoneDefinition,
  CityZoneIcon,
  ControlRoleDefinition,
  ControlRoleId,
} from "./types";

export const YIZHUANG_CENTER: [number, number] = [116.506, 39.795];
export const NEON_BUILDING_LAYER_ID = "neon-buildings";
export const AGENT_MOVE_DURATION_MS = 1650;
export const AGENT_STATES: VillageAgentState[] = [
  "idle",
  "walking",
  "working",
  "thinking",
  "reviewing",
  "celebrating",
];

export const CITY_ZONES: CityZoneDefinition[] = [
  {
    id: "esports-center",
    label: "赛事主场馆",
    caption: "电竞官与应援官联动的赛事情报前台",
    lngLat: [116.563, 39.768],
    icon: "trophy",
    accent: "#22d3ee",
  },
  {
    id: "ops-hub",
    label: "亦城总控台",
    caption: "亦城汇总 GOALS / STATUS 的城市总控席",
    lngLat: [116.528, 39.804],
    icon: "building",
    accent: "#60a5fa",
  },
  {
    id: "signal-tower",
    label: "舆情哨塔",
    caption: "舆情官扫描趋势、风险与热度波动的信号塔",
    lngLat: [116.545, 39.788],
    icon: "radar",
    accent: "#a855f7",
  },
  {
    id: "delivery-loop",
    label: "生活补给环",
    caption: "生活官把赛程热度转成到场与消费动线",
    lngLat: [116.492, 39.782],
    icon: "activity",
    accent: "#38bdf8",
  },
];

export const CITY_CONTROL_ROLES: ControlRoleDefinition[] = [
  {
    id: "yicheng",
    name: "亦城",
    title: "城市主理人",
    cadence: "8AM 晨会 / 9PM 日报",
    mission: "统筹 GOALS、STATUS 与城市日报，对外呈现今日焦点与城市故事。",
    signalLabel: "Lead relay",
    infoFlow: "汇总全队信号后输出城市日报与用户回答。",
    accent: "#60a5fa",
    primaryZoneId: "ops-hub",
    relatedZoneIds: ["ops-hub"],
  },
  {
    id: "esports",
    name: "电竞官",
    title: "赛事情报官",
    cadence: "每 3h",
    mission: "深挖赛事主场馆的赛程、选手、赛前赛后动态，形成主线情报。",
    signalLabel: "Match relay",
    infoFlow: "读取舆情热区后展开赛事情报深挖。",
    accent: "#22d3ee",
    primaryZoneId: "esports-center",
    relatedZoneIds: ["esports-center"],
  },
  {
    id: "lifestyle",
    name: "生活官",
    title: "本地生活编排",
    cadence: "11AM / 5PM",
    mission: "把赛事热度转译成餐饮、组局、补给与赛后动线建议。",
    signalLabel: "Lifestyle relay",
    infoFlow: "承接赛程热度，输出到场与赛后补给方案。",
    accent: "#38bdf8",
    primaryZoneId: "delivery-loop",
    relatedZoneIds: ["delivery-loop"],
  },
  {
    id: "cheerleader",
    name: "应援官",
    title: "应援内容中控",
    cadence: "每 4h 赛事节奏",
    mission: "把热点和赛况转成造势文案、口号与互动议程，放大现场氛围。",
    signalLabel: "Hype relay",
    infoFlow: "联动赛事窗口与舆情信号生成应援话题。",
    accent: "#f59e0b",
    primaryZoneId: "esports-center",
    relatedZoneIds: ["esports-center", "signal-tower"],
  },
  {
    id: "sentinel",
    name: "舆情官",
    title: "趋势哨兵",
    cadence: "每 2h 全网扫描",
    mission: "扫描论坛、内容平台与热搜，给整座城市提供趋势感知与风险预警。",
    signalLabel: "Sentinel relay",
    infoFlow: "捕捉全网趋势、情绪与风险波动，作为全队入口。",
    accent: "#a855f7",
    primaryZoneId: "signal-tower",
    relatedZoneIds: ["signal-tower"],
  },
];

export const CONTROL_ROLE_FLOW: ControlRoleId[] = [
  "sentinel",
  "esports",
  "cheerleader",
  "lifestyle",
  "yicheng",
];

export const CONTROL_ROLE_BY_ID = Object.fromEntries(
  CITY_CONTROL_ROLES.map((role) => [role.id, role]),
) as Record<ControlRoleId, ControlRoleDefinition>;

export const PHASE_META: Record<LightPreset, { icon: LucideIcon; label: string }> = {
  dawn: { icon: Sunrise, label: "清晨" },
  day: { icon: Sun, label: "白昼" },
  dusk: { icon: Sunset, label: "黄昏" },
  night: { icon: MoonStar, label: "夜间" },
};

export const ZONE_ICON_SVGS: Record<CityZoneIcon, string> = {
  trophy:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v3a5 5 0 0 1-10 0z"/><path d="M17 5h2a2 2 0 0 1 0 4h-2"/><path d="M7 5H5a2 2 0 0 0 0 4h2"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v18"/><path d="M6 12h8"/><path d="M10 7h.01"/><path d="M10 16h.01"/><path d="M18 22V9a1 1 0 0 0-1-1h-3"/></svg>',
  radar:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.3 6.3a8 8 0 1 1 11.4 11.4"/><path d="M4 12a8 8 0 0 1 8-8"/><path d="M12 4a8 8 0 0 1 8 8"/><path d="m12 12 5 5"/><path d="M12 12a2 2 0 1 0-2-2"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-4l-3 7-4-14-3 7H2"/></svg>',
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function setCityAgentStateClass(
  element: HTMLElement,
  state: VillageAgentState,
) {
  element.classList.remove(...AGENT_STATES.map((item) => `city-agent--${item}`));
  element.classList.add(`city-agent--${state}`);
}

export function setCitySpriteStateClass(
  element: HTMLElement,
  expression: ReturnType<typeof mapVillageStateToExpression>,
) {
  element.className = "city-agent-node";
  element.classList.add(`city-agent-node--${expression}`);
}

export function syncAgentMarkerAppearance(
  record: CityAgentMarkerRecord,
  agent: CityAgentModel,
  highlighted: boolean,
) {
  const zone = resolveNearestZone(agent.lngLat);
  const leadRole = CONTROL_ROLE_BY_ID[resolveLeadRoleId(zone.id, agent.state)];
  setCityAgentStateClass(record.element, agent.state);
  record.element.classList.toggle("is-highlighted", highlighted);
  record.element.style.setProperty("--agent-accent", agent.accent);
  record.nameEl.textContent = agent.name;
  record.statusEl.textContent = agent.statusText;
  record.detailEl.textContent = agent.detailText ?? "";
  record.detailEl.hidden = !agent.detailText;
  record.labelEl.dataset.role = `${leadRole.name} · ${leadRole.title}`;
  record.labelEl.dataset.zone = zone.label;
  const expression = mapVillageStateToExpression(agent.state);
  setCitySpriteStateClass(record.nodeEl, expression);
}

export function createAgentPopupHtml(agent: CityAgentModel): string {
  const zone = resolveNearestZone(agent.lngLat);
  const role = CONTROL_ROLE_BY_ID[resolveLeadRoleId(zone.id, agent.state)];
  const detail = agent.detailText ? `<p>${escapeHtml(agent.detailText)}</p>` : "";
  return `<div class="city-popup-content">
    <h3>${escapeHtml(agent.name)}</h3>
    <p>${escapeHtml(role.name)} · ${escapeHtml(role.title)}</p>
    <p>${escapeHtml(agent.statusText)}</p>
    <p>挂载区域：${escapeHtml(zone.label)}</p>
    <p>信号通道：${escapeHtml(role.signalLabel)}</p>
    ${detail}
    <div class="city-popup-tag">展示团队执行信标</div>
  </div>`;
}

export function createZonePopupHtml(zone: CityZoneDefinition): string {
  const owner = CONTROL_ROLE_BY_ID[resolveLeadRoleId(zone.id)];
  return `<div class="city-popup-content">
    <h3>${escapeHtml(zone.label)}</h3>
    <p>${escapeHtml(zone.caption)}</p>
    <p>值守角色：${escapeHtml(owner.name)} · ${escapeHtml(owner.title)}</p>
    <div class="city-popup-tag">展示团队功能区</div>
  </div>`;
}

export function resolveNearestZone(lngLat: [number, number]): CityZoneDefinition {
  return CITY_ZONES.reduce((closest, zone) => {
    const currentDistance =
      Math.pow(closest.lngLat[0] - lngLat[0], 2) +
      Math.pow(closest.lngLat[1] - lngLat[1], 2);
    const nextDistance =
      Math.pow(zone.lngLat[0] - lngLat[0], 2) +
      Math.pow(zone.lngLat[1] - lngLat[1], 2);
    return nextDistance < currentDistance ? zone : closest;
  });
}

export function getZoneDefinition(zoneId: CityZoneDefinition["id"]): CityZoneDefinition {
  return CITY_ZONES.find((zone) => zone.id === zoneId) ?? CITY_ZONES[0];
}

export function resolveLeadRoleId(
  zoneId: CityZoneDefinition["id"],
  state?: VillageAgentState,
): ControlRoleId {
  if (zoneId === "signal-tower") return "sentinel";
  if (zoneId === "delivery-loop") return "lifestyle";
  if (zoneId === "ops-hub") return "yicheng";
  if (zoneId === "esports-center") {
    return state === "celebrating" || state === "walking"
      ? "cheerleader"
      : "esports";
  }
  return "yicheng";
}

export { getLightPreset };
