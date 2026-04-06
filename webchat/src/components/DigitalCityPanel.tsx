import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Activity,
  Building2,
  Crosshair,
  type LucideIcon,
  MoonStar,
  Radar,
  Sun,
  Sunrise,
  Sunset,
  Trophy,
  Users,
  Workflow,
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getLightPreset, type LightPreset } from "../lib/sun-position";
import {
  mapVillageStateToExpression,
  type VillageAgentState,
} from "../village/VillageAgent";
import { useCitySimulation } from "../city/CitySimulation";
import { buildSpriteSheetPath, pickSpritePackIdFromSeed } from "../lib/sprite-packs";

const YIZHUANG_CENTER: [number, number] = [116.506, 39.795];
const ESPORTS_CENTER: [number, number] = [116.563, 39.768];
const NEON_BUILDING_LAYER_ID = "neon-buildings";
const AGENT_MOVE_DURATION_MS = 1650;
const AGENT_STATES: VillageAgentState[] = [
  "idle",
  "walking",
  "working",
  "thinking",
  "reviewing",
  "celebrating",
];

type CityZoneIcon = "trophy" | "building" | "radar" | "activity";
type ControlRoleId =
  | "yicheng"
  | "esports"
  | "lifestyle"
  | "cheerleader"
  | "sentinel";

interface CityZoneDefinition {
  id: string;
  label: string;
  caption: string;
  lngLat: [number, number];
  icon: CityZoneIcon;
  accent: string;
}

interface ControlRoleDefinition {
  id: ControlRoleId;
  name: string;
  title: string;
  cadence: string;
  mission: string;
  signalLabel: string;
  infoFlow: string;
  accent: string;
  primaryZoneId: CityZoneDefinition["id"];
  relatedZoneIds: CityZoneDefinition["id"][];
}

export interface CityAgentModel {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  state: VillageAgentState;
  statusText: string;
  detailText?: string | null;
  accent: string;
  lngLat: [number, number];
  spritePackId?: string;
}

interface CityAgentMarkerRecord {
  marker: mapboxgl.Marker;
  element: HTMLDivElement;
  labelEl: HTMLDivElement;
  nameEl: HTMLElement;
  statusEl: HTMLSpanElement;
  detailEl: HTMLElement;
  nodeEl: HTMLDivElement;
  currentLngLat: [number, number];
}

interface DigitalCityPanelProps {
  mapboxToken: string;
}

const FALLBACK_CITY_ZONES: CityZoneDefinition[] = [
  {
    id: "esports-center",
    label: "赛事主场馆",
    caption: "电竞官与应援官联动的赛事情报前台",
    lngLat: ESPORTS_CENTER,
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

const CITY_CONTROL_ROLES: ControlRoleDefinition[] = [
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

const CONTROL_ROLE_FLOW: ControlRoleId[] = [
  "sentinel",
  "esports",
  "cheerleader",
  "lifestyle",
  "yicheng",
];

const CONTROL_ROLE_BY_ID = Object.fromEntries(
  CITY_CONTROL_ROLES.map((role) => [role.id, role]),
) as Record<ControlRoleId, ControlRoleDefinition>;

const PHASE_META: Record<LightPreset, { icon: LucideIcon; label: string }> = {
  dawn: { icon: Sunrise, label: "清晨" },
  day: { icon: Sun, label: "白昼" },
  dusk: { icon: Sunset, label: "黄昏" },
  night: { icon: MoonStar, label: "夜间" },
};

const ZONE_ICON_SVGS: Record<CityZoneIcon, string> = {
  trophy:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v3a5 5 0 0 1-10 0z"/><path d="M17 5h2a2 2 0 0 1 0 4h-2"/><path d="M7 5H5a2 2 0 0 0 0 4h2"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v18"/><path d="M6 12h8"/><path d="M10 7h.01"/><path d="M10 16h.01"/><path d="M18 22V9a1 1 0 0 0-1-1h-3"/></svg>',
  radar:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.3 6.3a8 8 0 1 1 11.4 11.4"/><path d="M4 12a8 8 0 0 1 8-8"/><path d="M12 4a8 8 0 0 1 8 8"/><path d="m12 12 5 5"/><path d="M12 12a2 2 0 1 0-2-2"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-4l-3 7-4-14-3 7H2"/></svg>',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setCityAgentStateClass(element: HTMLElement, state: VillageAgentState) {
  element.classList.remove(...AGENT_STATES.map((item) => `city-agent--${item}`));
  element.classList.add(`city-agent--${state}`);
}

function setCitySpriteStateClass(
  element: HTMLElement,
  expression: ReturnType<typeof mapVillageStateToExpression>,
) {
  element.className = "city-agent-node";
  element.classList.add(`city-agent-node--${expression}`);
}

function syncAgentMarkerAppearance(
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

function createAgentPopupHtml(agent: CityAgentModel): string {
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

function createZonePopupHtml(zone: CityZoneDefinition): string {
  const owner = CONTROL_ROLE_BY_ID[resolveLeadRoleId(zone.id)];
  return `<div class="city-popup-content">
    <h3>${escapeHtml(zone.label)}</h3>
    <p>${escapeHtml(zone.caption)}</p>
    <p>值守角色：${escapeHtml(owner.name)} · ${escapeHtml(owner.title)}</p>
    <div class="city-popup-tag">展示团队功能区</div>
  </div>`;
}

function resolveNearestZone(lngLat: [number, number]): CityZoneDefinition {
  return FALLBACK_CITY_ZONES.reduce((closest, zone) => {
    const currentDistance =
      Math.pow(closest.lngLat[0] - lngLat[0], 2) +
      Math.pow(closest.lngLat[1] - lngLat[1], 2);
    const nextDistance =
      Math.pow(zone.lngLat[0] - lngLat[0], 2) +
      Math.pow(zone.lngLat[1] - lngLat[1], 2);
    return nextDistance < currentDistance ? zone : closest;
  });
}

function getZoneDefinition(zoneId: CityZoneDefinition["id"]): CityZoneDefinition {
  return (
    FALLBACK_CITY_ZONES.find((zone) => zone.id === zoneId) ??
    FALLBACK_CITY_ZONES[0]
  );
}

function resolveLeadRoleId(
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

export default function DigitalCityPanel({
  mapboxToken,
}: DigitalCityPanelProps) {
  const {
    agents: simAgents,
    highlightedAgentId: simHighlightedId,
    latestStory,
    activeCount: simActiveCount,
  } = useCitySimulation();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const zoneMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const agentMarkersRef = useRef<Map<string, CityAgentMarkerRecord>>(new Map());
  const agentAnimationRef = useRef<Map<string, number>>(new Map());
  const agentsByIdRef = useRef<Map<string, CityAgentModel>>(new Map());
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<LightPreset>(() => getLightPreset());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const showcaseAgents = useMemo(
    () =>
      CITY_CONTROL_ROLES.map((role) => {
        const relatedNodes = simAgents.filter((agent) =>
          role.relatedZoneIds.includes(resolveNearestZone(agent.lngLat).id),
        );
        const liveNode =
          relatedNodes.find((agent) => agent.state !== "idle") ?? relatedNodes[0] ?? null;
        const zone = getZoneDefinition(role.primaryZoneId);
        return {
          id: `showcase-${role.id}`,
          name: role.name,
          role: role.id,
          roleLabel: role.title,
          state: liveNode?.state ?? "idle",
          statusText: liveNode?.statusText ?? role.infoFlow,
          detailText: liveNode
            ? `${role.title} 正在 ${resolveNearestZone(liveNode.lngLat).label} 接收实时信号`
            : role.mission,
          accent: role.accent,
          lngLat: zone.lngLat,
          spritePackId: pickSpritePackIdFromSeed(role.id),
        } satisfies CityAgentModel;
      }),
    [simAgents],
  );

  const displayAgents = showcaseAgents;
  const effectiveHighlightedAgentId = simHighlightedId ?? selectedAgentId;
  const selectedAgent =
    displayAgents.find((agent) => agent.id === effectiveHighlightedAgentId) ??
    displayAgents[0] ??
    null;
  const selectedZone = selectedAgent ? resolveNearestZone(selectedAgent.lngLat) : FALLBACK_CITY_ZONES[0];
  const zoneSnapshots = useMemo(
    () =>
      FALLBACK_CITY_ZONES.map((zone) => {
        const liveNodes = simAgents.filter(
          (agent) => resolveNearestZone(agent.lngLat).id === zone.id,
        );
        return {
          zone,
          owner: CONTROL_ROLE_BY_ID[resolveLeadRoleId(zone.id)],
          nodeCount: liveNodes.length,
          activeNodeCount: liveNodes.filter((agent) => agent.state !== "idle").length,
          headline:
            liveNodes.find((agent) => agent.state !== "idle")?.statusText ??
            liveNodes[0]?.statusText ??
            zone.caption,
        };
      }),
    [displayAgents, simAgents],
  );
  const laneSnapshots = useMemo(
    () =>
      CITY_CONTROL_ROLES.map((role) => {
        const nodes = simAgents.filter((agent) =>
          role.relatedZoneIds.includes(resolveNearestZone(agent.lngLat).id),
        );
        const activeNodes = nodes.filter((agent) => agent.state !== "idle");
        const liveNode = activeNodes[0] ?? nodes[0] ?? null;

        return {
          ...role,
          liveNode,
          liveZone: liveNode
            ? resolveNearestZone(liveNode.lngLat)
            : getZoneDefinition(role.primaryZoneId),
          nodeCount: nodes.length,
          activeNodeCount: activeNodes.length,
          signalText: liveNode?.statusText ?? role.infoFlow,
        };
      }),
    [selectedAgent, simAgents],
  );
  const selectedLaneId = resolveLeadRoleId(selectedZone.id, selectedAgent?.state);
  const selectedLane =
    laneSnapshots.find((lane) => lane.id === selectedLaneId) ?? laneSnapshots[0];
  const selectedExpression = selectedAgent ? mapVillageStateToExpression(selectedAgent.state) : "idle";
  const selectedSpritePackId = pickSpritePackIdFromSeed(
    selectedLane?.id ?? selectedAgent?.id ?? "city",
  );
  const activeStreams = laneSnapshots.filter((lane) => lane.activeNodeCount > 0).length;
  const flowSnapshots = CONTROL_ROLE_FLOW.map(
    (roleId) => laneSnapshots.find((lane) => lane.id === roleId) ?? CONTROL_ROLE_BY_ID[roleId],
  );

  agentsByIdRef.current = new Map(displayAgents.map((agent) => [agent.id, agent]));

  const focusAgent = useCallback((agentId: string, fly = false) => {
    setSelectedAgentId(agentId);
    const nextAgent = agentsByIdRef.current.get(agentId);
    if (!nextAgent || !mapRef.current) return;
    if (fly) {
      mapRef.current.flyTo({
        center: nextAgent.lngLat,
        zoom: 16.8,
        pitch: 60,
        bearing: -14,
        speed: 0.75,
      });
    }
  }, []);

  const focusZone = useCallback((zoneId: CityZoneDefinition["id"]) => {
    const zone = getZoneDefinition(zoneId);
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: zone.lngLat,
      zoom: 16.9,
      pitch: 60,
      bearing: -12,
      speed: 0.75,
    });
  }, []);

  const initMap = useCallback(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: YIZHUANG_CENTER,
      zoom: 15.5,
      pitch: 62,
      bearing: -10,
      antialias: true,
    });

    mapRef.current = map;

    map.on("style.load", () => {
      const layers = map.getStyle().layers || [];
      for (const layer of layers) {
        if (layer.type === "symbol") {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }

      if (!map.getLayer(NEON_BUILDING_LAYER_ID)) {
        map.addLayer({
          id: NEON_BUILDING_LAYER_ID,
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": [
              "interpolate",
              ["linear"],
              ["get", "height"],
              0,
              "#0a1628",
              15,
              "#06b6d4",
              40,
              "#3b82f6",
              80,
              "#a855f7",
            ],
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.05, ["get", "height"]],
            "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.05, ["get", "min_height"]],
            "fill-extrusion-opacity": 0.75,
          },
        });
      }

      map.setFog({
        color: "rgba(2, 6, 23, 0.96)",
        "high-color": "rgba(8, 47, 73, 0.72)",
        "horizon-blend": 0.08,
        "space-color": "#020617",
        "star-intensity": 0.22,
      });
    });

    map.on("load", () => {
      setMapReady(true);
      setLoading(false);
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    return () => {
      zoneMarkersRef.current.forEach((marker) => marker.remove());
      zoneMarkersRef.current = [];
      for (const frame of agentAnimationRef.current.values()) {
        cancelAnimationFrame(frame);
      }
      agentAnimationRef.current.clear();
      for (const record of agentMarkersRef.current.values()) {
        record.marker.remove();
      }
      agentMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [mapboxToken]);

  useEffect(() => {
    const cleanup = initMap();
    return () => cleanup?.();
  }, [initMap]);

  useEffect(() => {
    const timer = setInterval(() => {
      const preset = getLightPreset();
      if (preset !== currentPreset) {
        setCurrentPreset(preset);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [currentPreset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || zoneMarkersRef.current.length > 0) return;

    zoneMarkersRef.current = FALLBACK_CITY_ZONES.map((zone) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "city-zone-marker";
      element.style.setProperty("--zone-accent", zone.accent);
      element.innerHTML = `<span class="city-zone-marker__icon">${ZONE_ICON_SVGS[zone.icon]}</span><span class="city-zone-marker__label">${escapeHtml(zone.label)}</span>`;

      const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
        .setLngLat(zone.lngLat)
        .setPopup(
          new mapboxgl.Popup({ offset: 22, className: "city-popup" }).setHTML(
            createZonePopupHtml(zone),
          ),
        )
        .addTo(map);

      element.addEventListener("click", () => {
        map.flyTo({
          center: zone.lngLat,
          zoom: 17,
          pitch: 60,
          bearing: -12,
          speed: 0.75,
        });
      });

      return marker;
    });
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const nextIds = new Set(displayAgents.map((agent) => agent.id));

    for (const [agentId, record] of agentMarkersRef.current.entries()) {
      if (nextIds.has(agentId)) continue;
      const frame = agentAnimationRef.current.get(agentId);
      if (frame) cancelAnimationFrame(frame);
      agentAnimationRef.current.delete(agentId);
      record.marker.remove();
      agentMarkersRef.current.delete(agentId);
    }

    for (const agent of displayAgents) {
      const highlighted = effectiveHighlightedAgentId === agent.id;
      const existing = agentMarkersRef.current.get(agent.id);

      if (!existing) {
        const element = document.createElement("div");
        element.className = "city-agent";

        const labelEl = document.createElement("div");
        labelEl.className = "city-agent-label";
        const nameEl = document.createElement("strong");
        const statusEl = document.createElement("span");
        const detailEl = document.createElement("em");
        labelEl.append(nameEl, statusEl, detailEl);

        const nodeEl = document.createElement("div");
        nodeEl.className = "city-agent-node";

        element.append(labelEl, nodeEl);

        const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
          .setLngLat(agent.lngLat)
          .setPopup(
            new mapboxgl.Popup({ offset: 22, className: "city-popup" }).setHTML(
              createAgentPopupHtml(agent),
            ),
          )
          .addTo(map);

        const record: CityAgentMarkerRecord = {
          marker,
          element,
          labelEl,
          nameEl,
          statusEl,
          detailEl,
          nodeEl,
          currentLngLat: agent.lngLat,
        };

        syncAgentMarkerAppearance(record, agent, highlighted);

        element.addEventListener("click", () => {
          focusAgent(agent.id, true);
        });

        agentMarkersRef.current.set(agent.id, record);
        continue;
      }

      existing.marker.setPopup(
        new mapboxgl.Popup({ offset: 22, className: "city-popup" }).setHTML(
          createAgentPopupHtml(agent),
        ),
      );

      const liveLngLat = existing.marker.getLngLat();
      const current: [number, number] = [liveLngLat.lng, liveLngLat.lat];
      existing.currentLngLat = current;
      syncAgentMarkerAppearance(existing, agent, highlighted);

      if (current[0] === agent.lngLat[0] && current[1] === agent.lngLat[1]) {
        continue;
      }

      const existingFrame = agentAnimationRef.current.get(agent.id);
      if (existingFrame) cancelAnimationFrame(existingFrame);

      const [fromLng, fromLat] = current;
      const [toLng, toLat] = agent.lngLat;
      const startedAt = performance.now();

      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / AGENT_MOVE_DURATION_MS, 1);
        const eased = 1 - (1 - progress) * (1 - progress);
        const nextLng = fromLng + (toLng - fromLng) * eased;
        const nextLat = fromLat + (toLat - fromLat) * eased;
        existing.marker.setLngLat([nextLng, nextLat]);

        if (progress < 1) {
          const frame = requestAnimationFrame(tick);
          agentAnimationRef.current.set(agent.id, frame);
          return;
        }

        existing.currentLngLat = agent.lngLat;
        agentAnimationRef.current.delete(agent.id);
      };

      const frame = requestAnimationFrame(tick);
      agentAnimationRef.current.set(agent.id, frame);
    }
  }, [displayAgents, effectiveHighlightedAgentId, focusAgent, mapReady]);

  useEffect(() => {
    for (const [agentId, record] of agentMarkersRef.current.entries()) {
      const agent = agentsByIdRef.current.get(agentId);
      if (!agent) continue;
      syncAgentMarkerAppearance(
        record,
        agent,
        effectiveHighlightedAgentId === agentId,
      );
    }
  }, [effectiveHighlightedAgentId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const PhaseIcon = PHASE_META[currentPreset].icon;

  return (
    <div className="digital-city">
      <div className="digital-city-map" ref={containerRef} />
      <div className="digital-city-grid-overlay" aria-hidden="true" />
      {loading && (
        <div className="digital-city-loading">
          <span className="spinner" />
          <span>正在加载数字之城…</span>
        </div>
      )}
      <div className="digital-city-hud">
        <div className="digital-city-header">
          <div className="digital-city-title-card">
            <div className="digital-city-title">
              <Building2 size={16} />
              <span>数字之城 v2 控制台</span>
            </div>
            <div className="digital-city-subtitle">5-Agent Showcase · Role-led Signals · World/City Continuum</div>
            <div className="digital-city-badges">
              <span className="digital-city-badge">
                <PhaseIcon size={14} />
                <span>{PHASE_META[currentPreset].label}</span>
              </span>
              <span className="digital-city-badge">
                <Radar size={14} />
                <span>{simActiveCount} 个活跃节点</span>
              </span>
              <span className="digital-city-badge">
                <Workflow size={14} />
                <span>{CITY_CONTROL_ROLES.length} 位展示角色</span>
              </span>
            </div>
          </div>

          <div className="digital-city-command-ribbon">
            <span className="digital-city-ribbon-item">
              <Crosshair size={13} />
              <span>焦点角色：{selectedLane?.name ?? "离线"} · {selectedLane?.title ?? "等待同步"}</span>
            </span>
            <span className="digital-city-ribbon-item">
              <Users size={13} />
              <span>信号运行：{activeStreams} / {CITY_CONTROL_ROLES.length}</span>
            </span>
            <span className="digital-city-ribbon-item">
              <Workflow size={13} />
              <span>当前区域：{selectedZone.label}</span>
            </span>
          </div>
        </div>

        <div className="digital-city-sidepanel">
          <section className="digital-city-panel digital-city-panel--focus">
            <div className="digital-city-panel-head">
              <strong>角色焦点</strong>
              <span>{selectedLane?.cadence ?? "同步中"}</span>
            </div>
            {selectedLane ? (
              <div className="digital-city-focus-card">
                <div
                  className={`digital-city-focus-sprite digital-city-focus-sprite--${selectedExpression}`}
                  style={{
                    backgroundImage: `url(${buildSpriteSheetPath(selectedSpritePackId, selectedExpression)})`,
                    "--agent-accent": selectedLane.accent,
                  } as CSSProperties}
                />
                <div className="digital-city-focus-copy">
                  <strong>{selectedLane.name}</strong>
                  <span>{selectedLane.title}</span>
                  <p>{selectedLane.mission}</p>
                  <div className="digital-city-focus-meta">
                    <span>当前区域：{selectedLane.liveZone.label}</span>
                    <span>通道：{selectedLane.signalLabel}</span>
                  </div>
                  <div className="digital-city-focus-live">
                    <label>Live node</label>
                    <strong>
                      {selectedLane.liveNode ? selectedLane.signalText : "等待节点接入"}
                    </strong>
                  </div>
                  <em>{selectedLane.infoFlow}</em>
                </div>
              </div>
            ) : (
              <div className="digital-city-panel-empty">城市节点正在同步。</div>
            )}
          </section>

          <section className="digital-city-panel">
            <div className="digital-city-panel-head">
              <strong>五人展示编队</strong>
              <span>Role mesh</span>
            </div>
            <div className="digital-city-roster">
              {laneSnapshots.map((lane) => (
                <button
                  key={lane.id}
                  className={`digital-city-roster-item${selectedLane?.id === lane.id ? " is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    if (lane.liveNode) {
                      focusAgent(lane.liveNode.id, true);
                      return;
                    }
                    focusZone(lane.primaryZoneId);
                  }}
                >
                  <span
                    className="digital-city-roster-dot"
                    style={{ backgroundColor: lane.accent }}
                  />
                  <div>
                    <strong>{lane.name}</strong>
                    <span>{lane.title}</span>
                  </div>
                  <em>{lane.signalText}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="digital-city-panel">
            <div className="digital-city-panel-head">
              <strong>城市功能区</strong>
              <span>Zone ownership</span>
            </div>
            <div className="digital-city-zones">
              {zoneSnapshots.map(({ zone, owner, nodeCount, activeNodeCount, headline }) => (
                <button
                  key={zone.id}
                  type="button"
                  className={`digital-city-zone-card${selectedZone.id === zone.id ? " is-active" : ""}`}
                  style={{ "--zone-accent": zone.accent } as CSSProperties}
                  onClick={() => focusZone(zone.id)}
                >
                  <div>
                    <strong>{zone.label}</strong>
                    <span>{zone.caption}</span>
                  </div>
                  <b>{owner.name}</b>
                  <small>{headline}</small>
                  <em>{activeNodeCount}/{nodeCount} live</em>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="digital-city-footerbar">
          {latestStory && <div className="digital-city-story">{latestStory}</div>}
          <div className="digital-city-flow">
            {flowSnapshots.map((lane, index) => (
              <span
                key={lane.id}
                className={`digital-city-flow-item${selectedLane?.id === lane.id ? " is-active" : ""}`}
              >
                <b>{lane.name}</b>
                <small>{lane.infoFlow}</small>
                {index < flowSnapshots.length - 1 && <i aria-hidden="true">→</i>}
              </span>
            ))}
          </div>
          <div className="digital-city-legend">
            <span className="legend-item">
              <Trophy size={13} />
              <span>赛事情报窗口</span>
            </span>
            <span className="legend-item">
              <Activity size={13} />
              <span>执行信标</span>
            </span>
            <span className="legend-item">
              <MoonStar size={13} />
              <span>生活补给 / 舆情中继</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
