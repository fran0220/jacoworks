import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Building2,
  type LucideIcon,
  MoonStar,
  Radar,
  Sun,
  Sunrise,
  Sunset,
  Trophy,
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

interface CityZoneDefinition {
  id: string;
  label: string;
  caption: string;
  lngLat: [number, number];
  icon: CityZoneIcon;
  accent: string;
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
  nameEl: HTMLElement;
  statusEl: HTMLSpanElement;
  detailEl: HTMLElement;
  badgeEl: HTMLSpanElement;
  spriteEl: HTMLDivElement;
  currentLngLat: [number, number];
}

interface DigitalCityPanelProps {
  mapboxToken: string;
}

const FALLBACK_CITY_ZONES: CityZoneDefinition[] = [
  {
    id: "esports-center",
    label: "智慧电竞赛事中心",
    caption: "赛事主场馆与展示窗口",
    lngLat: ESPORTS_CENTER,
    icon: "trophy",
    accent: "#22d3ee",
  },
  {
    id: "ops-hub",
    label: "运营中枢",
    caption: "多 Agent 调度与指挥席",
    lngLat: [116.528, 39.804],
    icon: "building",
    accent: "#60a5fa",
  },
  {
    id: "signal-tower",
    label: "信号塔站",
    caption: "观测流量与任务热区",
    lngLat: [116.545, 39.788],
    icon: "radar",
    accent: "#a855f7",
  },
  {
    id: "delivery-loop",
    label: "交付环带",
    caption: "执行与交付路径回路",
    lngLat: [116.492, 39.782],
    icon: "activity",
    accent: "#38bdf8",
  },
];

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
  element.className = "city-agent-sprite-sheet";
  element.classList.add(`city-agent-sprite-sheet--${expression}`);
}

function syncAgentMarkerAppearance(
  record: CityAgentMarkerRecord,
  agent: CityAgentModel,
  highlighted: boolean,
) {
  setCityAgentStateClass(record.element, agent.state);
  record.element.classList.toggle("is-highlighted", highlighted);
  record.element.style.setProperty("--agent-accent", agent.accent);
  record.nameEl.textContent = agent.name;
  record.statusEl.textContent = agent.statusText;
  record.detailEl.textContent = agent.detailText ?? "";
  record.detailEl.hidden = !agent.detailText;
  record.badgeEl.textContent = agent.roleLabel;
  const expression = mapVillageStateToExpression(agent.state);
  const spritePackId = agent.spritePackId || pickSpritePackIdFromSeed(agent.id || agent.name);
  setCitySpriteStateClass(record.spriteEl, expression);
  record.spriteEl.style.backgroundImage = `url(${buildSpriteSheetPath(spritePackId, expression)})`;
}

function createAgentPopupHtml(agent: CityAgentModel): string {
  const detail = agent.detailText ? `<p>${escapeHtml(agent.detailText)}</p>` : "";
  return `<div class="city-popup-content">
    <h3>${escapeHtml(agent.name)}</h3>
    <p>${escapeHtml(agent.roleLabel)}</p>
    <p>${escapeHtml(agent.statusText)}</p>
    ${detail}
    <div class="city-popup-tag">Agent 观测节点</div>
  </div>`;
}

function createZonePopupHtml(zone: CityZoneDefinition): string {
  return `<div class="city-popup-content">
    <h3>${escapeHtml(zone.label)}</h3>
    <p>${escapeHtml(zone.caption)}</p>
    <div class="city-popup-tag">城市功能区</div>
  </div>`;
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

  const displayAgents = simAgents;
  const effectiveHighlightedAgentId = simHighlightedId ?? selectedAgentId;

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

        const bubble = document.createElement("div");
        bubble.className = "city-agent-bubble";
        const nameEl = document.createElement("strong");
        const statusEl = document.createElement("span");
        const detailEl = document.createElement("em");
        bubble.append(nameEl, statusEl, detailEl);

        const shadowEl = document.createElement("div");
        shadowEl.className = "city-agent-shadow";
        const spriteEl = document.createElement("div");
        const badgeEl = document.createElement("span");
        badgeEl.className = "city-agent-badge";

        element.append(bubble, shadowEl, spriteEl, badgeEl);

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
          nameEl,
          statusEl,
          detailEl,
          badgeEl,
          spriteEl,
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
      {loading && (
        <div className="digital-city-loading">
          <span className="spinner" />
          <span>正在加载数字之城…</span>
        </div>
      )}
      <div className="digital-city-hud">
        <div className="digital-city-title-card">
          <div className="digital-city-title">
            <Building2 size={16} />
            <span>亦庄数字之城观测站</span>
          </div>
          <div className="digital-city-subtitle">Dark v11 · Neon 3D · Sprite Agents</div>
          <div className="digital-city-badges">
            <span className="digital-city-badge">
              <PhaseIcon size={14} />
              <span>{PHASE_META[currentPreset].label}</span>
            </span>
            <span className="digital-city-badge">
              <Radar size={14} />
              <span>{simActiveCount} 活跃中</span>
            </span>
          </div>
          {latestStory && (
            <div className="digital-city-story">{latestStory}</div>
          )}
        </div>
        <div className="digital-city-legend">
          <span className="legend-item">
            <Trophy size={13} />
            <span>核心场馆</span>
          </span>
          <span className="legend-item">
            <Activity size={13} />
            <span>活跃 Agent</span>
          </span>
          <span className="legend-item">
            <MoonStar size={13} />
            <span>待命 Agent</span>
          </span>
        </div>
      </div>
    </div>
  );
}
