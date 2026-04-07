import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Flame, Loader, Minus, Plus, Maximize2, Users, X } from "lucide-react";
import useOperations from "../hooks/useOperations";
import type { CrewTask } from "../lib/feed";
import { matchesTemplateSessionKey } from "../lib/team-utils";
import type { TeamTemplate } from "../lib/teams";
import {
  buildSpriteSheetPath,
  buildSpriteReferencePath,
} from "../lib/sprite-packs";
import {
  mapVillageStateToExpression,
  type VillageAgentModel,
} from "./VillageAgent";
import { useVillageCamera, getMapStyle, MAP_W, MAP_H } from "./VillageCamera";
import {
  useYSortedElements,
  VILLAGE_BUILDINGS,
  type VillageBuilding,
} from "./VillageYSort";
import VillageVFX from "./VillageVFX";
import { useVillageBridge } from "./VillageBridge";
import {
  buildCropPlots,
  listVillageZones,
  type TaskCropInput,
  VILLAGE_MAP_ASSETS,
} from "./VillageMap";
import type { VillageZoneId } from "./VillageZone";

interface VillageSceneProps {
  template: TeamTemplate;
  activeSessionKey: string;
  onBack: () => void;
  onLaunchTeam: (template: TeamTemplate) => Promise<void> | void;
  variant?: "modal" | "inline";
}

type AssetLoadState = "loading" | "ready" | "error";

function useMapAssetLoader(): { state: AssetLoadState; progress: number } {
  const [state, setState] = useState<AssetLoadState>("loading");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setProgress(100);
        setState("ready");
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setProgress(100);
        setState("error");
      }
    };
    img.src = VILLAGE_MAP_ASSETS.overview;
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, progress };
}

function mapCrewTaskToCropStatus(task: CrewTask): TaskCropInput["status"] {
  if (task.status === "done") return "done";
  if (task.status === "assigned") return "assigned";
  if (task.status === "running" || task.status === "in-progress") return "running";
  if (task.status === "failed" || task.status === "blocked") return "failed";
  if (task.status === "timeout") return "timeout";
  return "pending";
}

function buildCrewCropInputs(tasks: CrewTask[]): TaskCropInput[] | undefined {
  if (tasks.length === 0) return undefined;

  const pendingTask = tasks.find((task) => mapCrewTaskToCropStatus(task) === "pending");
  const activeTask = tasks.find((task) => {
    const status = mapCrewTaskToCropStatus(task);
    return status === "assigned" || status === "running";
  });
  const deliveryTask = tasks.find((task) => {
    const status = mapCrewTaskToCropStatus(task);
    return status === "done" || status === "failed" || status === "timeout";
  });

  const ordered = [pendingTask, activeTask, deliveryTask].filter(
    (task): task is CrewTask => task !== undefined,
  );

  if (ordered.length === 0) {
    return tasks.slice(0, 3).map((task) => ({
      taskId: task.id,
      status: mapCrewTaskToCropStatus(task),
      label: task.name,
    }));
  }

  return ordered.map((task) => ({
    taskId: task.id,
    status: mapCrewTaskToCropStatus(task),
    label: task.name,
  }));
}

const ZONE_COLORS: Record<VillageZoneId, string> = {
  hq: "#5b74ff",
  watchtower: "#9076ff",
  market: "#e38a3d",
  library: "#4f8d57",
  campfire: "#ff9f1c",
  plaza: "#6366f1",
  docks: "#3fa873",
  crops: "#bc6b4a",
};

function AgentPopover({
  agent,
  onClose,
}: {
  agent: VillageAgentModel;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="village-agent-popover"
      style={{
        left: `${(agent.position.x / 100) * MAP_W}px`,
        top: `${(agent.position.y / 100) * MAP_H}px`,
      }}
    >
      <button className="village-popover-close" type="button" onClick={onClose}>
        <X size={12} />
      </button>
      <div className="village-popover-header">
        <img
          className="village-popover-ref"
          src={buildSpriteReferencePath(agent.spritePackId)}
          alt={agent.name}
        />
        <div>
          <strong>{agent.name}</strong>
          <span
            className="village-popover-role"
            style={{ backgroundColor: agent.accent }}
          >
            {agent.roleLabel}
          </span>
        </div>
      </div>
      <div className="village-popover-body">
        <span className={`village-popover-state village-popover-state--${agent.state}`}>
          {agent.statusText}
        </span>
        {agent.detailText && <em>{agent.detailText}</em>}
      </div>
    </div>
  );
}

function BuildingMarker({
  building,
  zIndex,
}: {
  building: VillageBuilding;
  zIndex: number;
}) {
  const [hovered, setHovered] = useState(false);
  const color = ZONE_COLORS[building.zoneId];

  return (
    <div
      className="village-building-marker"
      style={{
        left: `${(building.position.x / 100) * MAP_W}px`,
        top: `${(building.position.y / 100) * MAP_H}px`,
        zIndex,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="village-building-dot"
        style={{ backgroundColor: color }}
      />
      {hovered && (
        <span className="village-building-tooltip">{building.label}</span>
      )}
    </div>
  );
}

export default function VillageScene({
  template,
  activeSessionKey,
  onBack,
  onLaunchTeam,
  variant = "modal",
}: VillageSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapAssets = useMapAssetLoader();
  const isLive = matchesTemplateSessionKey(template, activeSessionKey);
  const operations = useOperations(
    isLive ? activeSessionKey : template.workspaceKeyPrefix,
  );
  const bridge = useVillageBridge(
    template,
    operations.agentSummaries,
    operations.activities,
    operations.dashboardStats,
  );
  const { camera, handlers, zoomIn, zoomOut, resetView, panTo } =
    useVillageCamera(containerRef);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const cropTaskInputs = useMemo(
    () => buildCrewCropInputs(operations.crewTasks),
    [operations.crewTasks],
  );
  const cropPlots = useMemo(
    () => buildCropPlots(operations.dashboardStats, bridge.activeCount, cropTaskInputs),
    [bridge.activeCount, cropTaskInputs, operations.dashboardStats],
  );
  const villageZones = useMemo(() => listVillageZones(), []);
  const ySortedElements = useYSortedElements(bridge.agents, VILLAGE_BUILDINGS);

  const agentMap = useMemo(() => {
    const map = new Map<string, VillageAgentModel>();
    for (const agent of bridge.agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [bridge.agents]);

  const buildingMap = useMemo(() => {
    const map = new Map<string, VillageBuilding>();
    for (const b of VILLAGE_BUILDINGS) {
      map.set(b.id, b);
    }
    return map;
  }, []);

  const selectedAgent = selectedAgentId ? agentMap.get(selectedAgentId) ?? null : null;

  const handleAgentClick = useCallback((agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgentId((prev) => (prev === agentId ? null : agentId));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = handlers.onWheel;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [handlers.onWheel]);

  const mapReady = mapAssets.state !== "loading";

  const mapStyle: CSSProperties = {
    ...getMapStyle(camera),
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -(MAP_W / 2),
    marginTop: -(MAP_H / 2),
    backgroundImage: `url(${VILLAGE_MAP_ASSETS.overview})`,
    backgroundSize: "100% 100%",
    imageRendering: "pixelated",
  };

  const viewport = (
    <>
      {!mapReady && (
        <div className="village-load-screen village-load-screen--overlay">
          <Loader size={24} className="spin-icon" />
          <strong>搭建协作小镇…</strong>
          <div className="village-load-bar">
            <div className="village-load-fill" style={{ width: `${mapAssets.progress}%` }} />
          </div>
          <span>{mapAssets.progress}%</span>
        </div>
      )}

      <div
        className="village-viewport"
        ref={containerRef}
        onPointerDown={handlers.onPointerDown as unknown as React.PointerEventHandler}
        onPointerMove={handlers.onPointerMove as unknown as React.PointerEventHandler}
        onPointerUp={handlers.onPointerUp as unknown as React.PointerEventHandler}
      >
        <div className="village-map" style={mapStyle}>
          <VillageVFX />

          {villageZones.map((zone) => (
            <div
              key={zone.id}
              className={`village-zone-chip${bridge.zoneEffects[zone.id] ? " village-zone-chip--reserved" : ""}`}
              style={{
                left: `${(zone.anchor.x / 100) * MAP_W}px`,
                top: `${(zone.anchor.y / 100) * MAP_H}px`,
                zIndex: 2000,
                cursor: "pointer",
              }}
              onClick={(e) => {
                e.stopPropagation();
                panTo(zone.anchor.x, zone.anchor.y);
              }}
            >
              <span aria-hidden="true">{zone.icon}</span>
              <div>
                <strong>{zone.label}</strong>
                <em>{zone.caption}</em>
                {bridge.zoneEffects[zone.id] && (
                  <em>
                    锁定 {bridge.zoneEffects[zone.id]?.reserveCount ?? 0} 项 · {bridge.zoneEffects[zone.id]?.reservedPaths[0]}
                  </em>
                )}
              </div>
            </div>
          ))}

          {cropPlots.map((plot) => (
            <div
              key={plot.id}
              className={`village-crop-plot village-crop-plot--${plot.stage}${plot.taskId ? " has-task" : ""}`}
              style={{
                left: `${(plot.x / 100) * MAP_W}px`,
                top: `${(plot.y / 100) * MAP_H}px`,
              }}
            >
              <span>{plot.label}</span>
            </div>
          ))}

          {ySortedElements.map((element) => {
            if (element.type === "building") {
              const building = buildingMap.get(element.id);
              if (!building) return null;
              return (
                <BuildingMarker
                  key={element.id}
                  building={building}
                  zIndex={element.zIndex}
                />
              );
            }

            const agent = agentMap.get(element.id);
            if (!agent) return null;
            const expression = mapVillageStateToExpression(agent.state);
            const isHighlighted = bridge.highlightedAgentId === agent.id;

            return (
              <div
                key={agent.id}
                className={`village-agent village-agent--${agent.state}${isHighlighted ? " is-highlighted" : ""}`}
                style={{
                  left: `${(agent.position.x / 100) * MAP_W}px`,
                  top: `${(agent.position.y / 100) * MAP_H}px`,
                  zIndex: element.zIndex,
                  "--agent-accent": agent.accent,
                } as CSSProperties}
                onClick={(e) => handleAgentClick(agent.id, e)}
              >
                <div className="village-agent-bubble">
                  <strong>{agent.name}</strong>
                  <span>{agent.statusText}</span>
                  {agent.detailText && <em>{agent.detailText}</em>}
                </div>
                <div className="village-agent-shadow" />
                <div
                  className={`village-agent-sprite village-agent-sprite--${expression}`}
                  style={{
                    backgroundImage: `url(${buildSpriteSheetPath(agent.spritePackId, expression)})`,
                  }}
                />
                <span className="village-agent-badge">{agent.roleLabel}</span>
              </div>
            );
          })}

          {selectedAgent && (
            <AgentPopover
              agent={selectedAgent}
              onClose={() => setSelectedAgentId(null)}
            />
          )}
        </div>
      </div>

      <div className="village-zoom-controls">
        <button type="button" onClick={zoomIn} title="放大">
          <Plus size={14} />
        </button>
        <button type="button" onClick={zoomOut} title="缩小">
          <Minus size={14} />
        </button>
        <button type="button" onClick={resetView} title="重置视角">
          <Maximize2 size={14} />
        </button>
      </div>
    </>
  );

  if (variant === "inline") {
    return (
      <div className="village-inline">
        {viewport}
        <div className="village-inline-status">
          <span>
            <Flame size={12} />
            {bridge.activeCount} 活跃
          </span>
          <span className="village-inline-story">{bridge.latestStory}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="village-overlay" role="dialog" aria-modal="true">
      <div className="village-overlay-backdrop" onClick={onBack} />
      <section className="village-shell village-shell--viewport">
        <header className="village-topbar">
          <button className="village-back-btn" type="button" onClick={onBack}>
            <X size={16} />
            <span>关闭</span>
          </button>
          <div className="village-title-block">
            <h2>{template.icon || "🏘️"} {template.label} 协作小镇</h2>
          </div>
          <div className="village-topbar-actions">
            {!isLive && (
              <button
                className="village-primary-btn"
                type="button"
                onClick={() => void onLaunchTeam(template)}
              >
                启动团队
              </button>
            )}
            {isLive && (
              <span className="village-live-pill">
                <Users size={12} />
                {bridge.activeCount} 活跃
              </span>
            )}
          </div>
        </header>
        <div className="village-modal-viewport">
          {viewport}
        </div>
        <div className="village-inline-status">
          <span>
            <Flame size={12} />
            {bridge.activeCount} 活跃
          </span>
          <span className="village-inline-story">{bridge.latestStory}</span>
        </div>
      </section>
    </div>
  );
}
