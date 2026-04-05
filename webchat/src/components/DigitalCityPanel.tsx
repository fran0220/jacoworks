import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getLightPreset, type LightPreset } from "../lib/sun-position";

const YIZHUANG_CENTER: [number, number] = [116.506, 39.795];
const ESPORTS_CENTER: [number, number] = [116.563, 39.768];

interface DigitalCityPanelProps {
  mapboxToken: string;
}

export default function DigitalCityPanel({ mapboxToken }: DigitalCityPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPreset, setCurrentPreset] = useState<LightPreset>(() => getLightPreset());

  const initMap = useCallback(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard",
      center: YIZHUANG_CENTER,
      zoom: 15.5,
      pitch: 62,
      bearing: -10,
      projection: "globe",
      antialias: true,
    });

    mapRef.current = map;

    map.on("style.load", () => {
      const preset = getLightPreset();
      setCurrentPreset(preset);
      map.setConfigProperty("basemap", "lightPreset", preset);
      map.setConfigProperty("basemap", "show3dObjects", true);
      map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      map.setConfigProperty("basemap", "showTransitLabels", false);
      map.setConfigProperty("basemap", "showPlaceLabels", false);
      map.setConfigProperty("basemap", "showRoadLabels", false);

      map.setFog({
        color: "rgb(186, 210, 235)",
        "high-color": "rgb(36, 92, 223)",
        "horizon-blend": 0.02,
        "space-color": "rgb(11, 11, 25)",
        "star-intensity": 0.6,
      });

      setLoading(false);
    });

    map.on("load", () => {
      const layers = map.getStyle().layers || [];
      for (const layer of layers) {
        if (layer.type === "symbol") {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }

      const markerEl = document.createElement("div");
      markerEl.className = "city-marker city-marker--esports";
      markerEl.innerHTML = `<span class="city-marker-pulse"></span><span class="city-marker-label">智慧电竞赛事中心</span>`;

      new mapboxgl.Marker({ element: markerEl })
        .setLngLat(ESPORTS_CENTER)
        .setPopup(
          new mapboxgl.Popup({ offset: 25, className: "city-popup" }).setHTML(
            `<div class="city-popup-content">
              <h3>🎮 北京智慧电竞赛事中心</h3>
              <p>嘉创二路6号 · JDG英特尔电子竞技中心</p>
              <p>占地 6.7万㎡ · 裸眼3D屏 · 专业电竞主场馆</p>
              <div class="city-popup-tag">JAcoworks 数字之城核心节点</div>
            </div>`
          )
        )
        .addTo(map);

      const demoNodes = [
        { lngLat: [116.510, 39.800] as [number, number], name: "用户 Alpha", status: "active" },
        { lngLat: [116.520, 39.790] as [number, number], name: "用户 Beta", status: "active" },
        { lngLat: [116.500, 39.785] as [number, number], name: "用户 Gamma", status: "idle" },
        { lngLat: [116.555, 39.775] as [number, number], name: "用户 Delta", status: "active" },
        { lngLat: [116.530, 39.802] as [number, number], name: "用户 Epsilon", status: "idle" },
      ];

      for (const node of demoNodes) {
        const el = document.createElement("div");
        el.className = `city-marker city-marker--node city-marker--${node.status}`;
        el.innerHTML = `<span class="city-marker-pulse"></span>`;

        new mapboxgl.Marker({ element: el })
          .setLngLat(node.lngLat)
          .setPopup(
            new mapboxgl.Popup({ offset: 15, className: "city-popup" }).setHTML(
              `<div class="city-popup-content">
                <h3>🤖 ${node.name}</h3>
                <p>AI 工作区状态: ${node.status === "active" ? "🟢 活跃" : "⚪ 空闲"}</p>
                <div class="city-popup-tag">Agent 团队运行中</div>
              </div>`
            )
          )
          .addTo(map);
      }
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const cleanup = initMap();
    return () => cleanup?.();
  }, [initMap]);

  useEffect(() => {
    const timer = setInterval(() => {
      const preset = getLightPreset();
      if (preset !== currentPreset && mapRef.current) {
        setCurrentPreset(preset);
        mapRef.current.setConfigProperty("basemap", "lightPreset", preset);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [currentPreset]);

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
      {loading && (
        <div className="digital-city-loading">
          <span className="spinner" />
          <span>正在加载数字之城…</span>
        </div>
      )}
      <div className="digital-city-hud">
        <div className="digital-city-title">
          🏙️ 亦庄数字之城
          <span className="badge">
            {currentPreset === "night" ? "🌙" : currentPreset === "dawn" ? "🌅" : currentPreset === "dusk" ? "🌇" : "☀️"} {currentPreset}
          </span>
        </div>
        <div className="digital-city-legend">
          <span className="legend-item"><span className="legend-dot legend-dot--esports" />电竞中心</span>
          <span className="legend-item"><span className="legend-dot legend-dot--active" />活跃节点</span>
          <span className="legend-item"><span className="legend-dot legend-dot--idle" />空闲节点</span>
        </div>
      </div>
    </div>
  );
}
