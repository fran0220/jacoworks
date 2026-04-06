import { useMemo, type CSSProperties } from "react";
import {
  ArrowLeft,
  Flame,
  MapPin,
  Play,
  RefreshCw,
  Sparkles,
  Sprout,
  TreePine,
  Users,
} from "lucide-react";
import useOperations from "../hooks/useOperations";
import { matchesTemplateSessionKey } from "../lib/team-utils";
import type { TeamTemplate } from "../lib/teams";
import {
  mapVillageStateToExpression,
  type VillageAgentModel,
} from "./VillageAgent";
import { buildSpriteSheetPath } from "../lib/sprite-packs";
import {
  buildCropPlots,
  getVillageAspectRatio,
  getZonePresence,
  listVillageZones,
  VILLAGE_MAP_ASSETS,
} from "./VillageMap";
import { useVillageBridge } from "./VillageBridge";

interface VillageSceneProps {
  template: TeamTemplate;
  activeSessionKey: string;
  onBack: () => void;
  onLaunchTeam: (template: TeamTemplate) => Promise<void> | void;
}

function renderVillageAgent(
  agent: VillageAgentModel,
  highlightedAgentId: string | null,
) {
  const expression = mapVillageStateToExpression(agent.state);
  const isHighlighted = highlightedAgentId === agent.id;

  return (
    <div
      key={agent.id}
      className={`village-agent village-agent--${agent.state}${isHighlighted ? " is-highlighted" : ""}`}
      style={
        {
          left: `${agent.position.x}%`,
          top: `${agent.position.y}%`,
          "--agent-accent": agent.accent,
        } as CSSProperties
      }
    >
      <div className="village-agent-bubble">
        <strong>{agent.name}</strong>
        <span>{agent.statusText}</span>
        {agent.detailText && <em>{agent.detailText}</em>}
      </div>
      <div className="village-agent-shadow" />
      <div
        className={`village-agent-sprite-sheet village-agent-sprite-sheet--${expression}`}
        style={{ backgroundImage: `url(${buildSpriteSheetPath(agent.spritePackId, expression)})` }}
      />
      <span className="village-agent-badge">{agent.roleLabel}</span>
    </div>
  );
}

export default function VillageScene({
  template,
  activeSessionKey,
  onBack,
  onLaunchTeam,
}: VillageSceneProps) {
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

  const cropPlots = useMemo(
    () => buildCropPlots(operations.dashboardStats, bridge.activeCount),
    [bridge.activeCount, operations.dashboardStats],
  );
  const zonePresence = useMemo(
    () => getZonePresence(bridge.agents),
    [bridge.agents],
  );
  const villageZones = useMemo(() => listVillageZones(), []);

  return (
    <div className="village-overlay" role="dialog" aria-modal="true">
      <div className="village-overlay-backdrop" onClick={onBack} />
      <section className="village-shell">
        <header className="village-topbar">
          <button className="village-back-btn" type="button" onClick={onBack}>
            <ArrowLeft size={16} />
            <span>返回团队页</span>
          </button>

          <div className="village-title-block">
            <span className="village-kicker">
              {template.icon || "🏘️"} Team Village Preview
            </span>
            <h2>{template.label} 协作小镇</h2>
            <p>
              {isLive
                ? "实时映射团队在村庄里的分工流动，营火、广场和各建筑会随着协作状态变化。"
                : "离线预演视角。先看看角色分布，准备好后再启动团队进入实时模式。"}
            </p>
          </div>

          <div className="village-topbar-actions">
            <button
              className="village-ghost-btn"
              type="button"
              onClick={() => void operations.refresh()}
              disabled={operations.loading}
            >
              <RefreshCw size={14} className={operations.loading ? "spin-icon" : undefined} />
              <span>刷新实况</span>
            </button>
            {!isLive && (
              <button
                className="village-primary-btn"
                type="button"
                onClick={() => void onLaunchTeam(template)}
              >
                <Play size={15} />
                <span>启动团队</span>
              </button>
            )}
            {isLive && <span className="village-live-pill">实时连接中</span>}
          </div>
        </header>

        <div className="village-body">
          <aside className="village-sidebar village-sidebar--left">
            <div className="village-panel-card village-panel-card--hero">
              <span className="village-panel-eyebrow">
                <Sparkles size={14} />
                实时故事线
              </span>
              <p className="village-story">{bridge.latestStory}</p>
              <div className="village-stat-row">
                <span>
                  <Users size={14} />
                  成员 {template.members.length}
                </span>
                <span>
                  <Flame size={14} />
                  活跃 {bridge.activeCount}
                </span>
              </div>
            </div>

            <div className="village-panel-card">
              <h3>村民名册</h3>
              <ul className="village-roster">
                {bridge.agents.map((agent) => (
                  <li key={agent.id}>
                    <span
                      className="village-roster-dot"
                      style={{ backgroundColor: agent.accent }}
                    />
                    <div>
                      <strong>{agent.name}</strong>
                      <span>{agent.roleLabel}</span>
                    </div>
                    <em>{agent.statusText}</em>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <main className="village-stage-panel">
            <div className="village-stage-frame">
              <div
                className="village-map-scene"
                style={
                  {
                    backgroundImage: `url(${VILLAGE_MAP_ASSETS.overview})`,
                    aspectRatio: String(getVillageAspectRatio()),
                  } as CSSProperties
                }
              >
                <div className="village-map-atmosphere" />
                <div className="village-map-vignette" />

                {cropPlots.map((plot) => (
                  <div
                    key={plot.id}
                    className={`village-crop-plot village-crop-plot--${plot.stage}${plot.taskId ? " has-task" : ""}`}
                    style={{ left: `${plot.x}%`, top: `${plot.y}%` }}
                  >
                    <span>{plot.label}</span>
                  </div>
                ))}

                {villageZones.map((zone) => (
                  <div
                    key={zone.id}
                    className="village-zone-chip"
                    style={{ left: `${zone.anchor.x}%`, top: `${zone.anchor.y}%` }}
                  >
                    <span aria-hidden="true">{zone.icon}</span>
                    <div>
                      <strong>{zone.label}</strong>
                      <em>{zone.caption}</em>
                    </div>
                  </div>
                ))}

                {bridge.agents.map((agent) =>
                  renderVillageAgent(agent, bridge.highlightedAgentId),
                )}
              </div>
            </div>
          </main>

          <aside className="village-sidebar village-sidebar--right">
            <div className="village-panel-card">
              <h3>建筑热度</h3>
              <ul className="village-zone-list">
                {villageZones.map((zone) => (
                  <li key={zone.id}>
                    <span>
                      {zone.icon} {zone.label}
                    </span>
                    <strong>{zonePresence[zone.id] ?? 0}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className="village-panel-card village-panel-card--legend">
              <h3>农田进度</h3>
              <div className="village-legend-grid">
                <div>
                  <Sprout size={14} />
                  <span>播种</span>
                </div>
                <div>
                  <TreePine size={14} />
                  <span>生长</span>
                </div>
                <div>
                  <MapPin size={14} />
                  <span>交付</span>
                </div>
              </div>
              <p>
                三块农田分别代表任务拆解、执行推进与交付成熟，活跃度越高，庄稼越繁盛。
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
