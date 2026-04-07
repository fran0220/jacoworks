import { type CSSProperties } from "react";
import {
  Activity,
  Building2,
  Crosshair,
  MoonStar,
  Radar,
  Trophy,
  Users,
  Workflow,
} from "lucide-react";
import { buildSpriteSheetPath } from "../../lib/sprite-packs";
import type { SpriteExpression } from "../../lib/sprite-packs/paths";
import { CITY_CONTROL_ROLES, PHASE_META } from "./config";
import type {
  CityLaneSnapshot,
  CityZoneDefinition,
  CityZoneSnapshot,
} from "./types";

interface DigitalCityHudProps {
  loading: boolean;
  currentPreset: keyof typeof PHASE_META;
  simActiveCount: number;
  latestStory: string;
  selectedLane: CityLaneSnapshot | undefined;
  selectedZone: CityZoneDefinition;
  selectedExpression: SpriteExpression;
  selectedSpritePackId: string;
  activeStreams: number;
  laneSnapshots: CityLaneSnapshot[];
  zoneSnapshots: CityZoneSnapshot[];
  flowSnapshots: CityLaneSnapshot[];
  onFocusAgent: (agentId: string, fly?: boolean) => void;
  onFocusZone: (zoneId: CityZoneDefinition["id"]) => void;
}

export default function DigitalCityHud({
  loading,
  currentPreset,
  simActiveCount,
  latestStory,
  selectedLane,
  selectedZone,
  selectedExpression,
  selectedSpritePackId,
  activeStreams,
  laneSnapshots,
  zoneSnapshots,
  flowSnapshots,
  onFocusAgent,
  onFocusZone,
}: DigitalCityHudProps) {
  const PhaseIcon = PHASE_META[currentPreset].icon;

  return (
    <div className="digital-city-hud">
      {loading && (
        <div className="digital-city-loading">
          <span className="spinner" />
          <span>正在加载数字之城…</span>
        </div>
      )}
      <div className="digital-city-header">
        <div className="digital-city-title-card">
          <div className="digital-city-title">
            <Building2 size={16} />
            <span>数字之城 v2 控制台</span>
          </div>
          <div className="digital-city-subtitle">
            5-Agent Showcase · Role-led Signals · World/City Continuum
          </div>
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
            <span>
              焦点角色：{selectedLane?.name ?? "离线"} ·{" "}
              {selectedLane?.title ?? "等待同步"}
            </span>
          </span>
          <span className="digital-city-ribbon-item">
            <Users size={13} />
            <span>
              信号运行：{activeStreams} / {CITY_CONTROL_ROLES.length}
            </span>
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
                    onFocusAgent(lane.liveNode.id, true);
                    return;
                  }
                  onFocusZone(lane.primaryZoneId);
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
                onClick={() => onFocusZone(zone.id)}
              >
                <div>
                  <strong>{zone.label}</strong>
                  <span>{zone.caption}</span>
                </div>
                <b>{owner.name}</b>
                <small>{headline}</small>
                <em>
                  {activeNodeCount}/{nodeCount} live
                </em>
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
  );
}
