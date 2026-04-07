import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { type LightPreset } from "../lib/sun-position";
import { useCitySimulation } from "../city/CitySimulation";
import {
  AGENT_MOVE_DURATION_MS,
  CITY_ZONES,
  NEON_BUILDING_LAYER_ID,
  YIZHUANG_CENTER,
  ZONE_ICON_SVGS,
  createAgentPopupHtml,
  createZonePopupHtml,
  escapeHtml,
  getLightPreset,
  getZoneDefinition,
  syncAgentMarkerAppearance,
} from "./digital-city/config";
import type { CityAgentMarkerRecord, CityAgentModel, CityZoneDefinition } from "./digital-city/types";
import DigitalCityHud from "./digital-city/DigitalCityHud";
import { useDigitalCityViewModel } from "./digital-city/view-model";

interface DigitalCityPanelProps {
  mapboxToken: string;
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
  const {
    displayAgents,
    effectiveHighlightedAgentId,
    selectedZone,
    zoneSnapshots,
    laneSnapshots,
    selectedLane,
    selectedExpression,
    selectedSpritePackId,
    activeStreams,
    flowSnapshots,
  } = useDigitalCityViewModel({
    simAgents,
    simHighlightedId,
    selectedAgentId,
  });

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

    zoneMarkersRef.current = CITY_ZONES.map((zone) => {
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

  return (
    <div className="digital-city">
      <div className="digital-city-map" ref={containerRef} />
      <div className="digital-city-grid-overlay" aria-hidden="true" />
      <DigitalCityHud
        loading={loading}
        currentPreset={currentPreset}
        simActiveCount={simActiveCount}
        latestStory={latestStory}
        selectedLane={selectedLane}
        selectedZone={selectedZone}
        selectedExpression={selectedExpression}
        selectedSpritePackId={selectedSpritePackId}
        activeStreams={activeStreams}
        laneSnapshots={laneSnapshots}
        zoneSnapshots={zoneSnapshots}
        flowSnapshots={flowSnapshots}
        onFocusAgent={focusAgent}
        onFocusZone={focusZone}
      />
    </div>
  );
}
