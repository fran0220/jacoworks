import { useMemo, useRef, useState } from "react";
import { Activity, Radio, Users, Workflow } from "lucide-react";
import type { AgentSummary } from "../lib/feed";
import type { AgentPreset, TeamsResponse } from "../lib/teams";
import { resolveLeaderInfo } from "../lib/team-utils";
import LeaderAssistant from "../observatory/hud/LeaderAssistant";
import type { LeaderAssistantHandle } from "../observatory/hud/LeaderAssistant";
import { buildRoleMatrix, buildTeamOptionsWithFallback } from "./agent-observatory/hud";
import {
  useLeaderAssistantBridge,
  useObservatoryPolling,
  useObservatoryScene,
  useObservatoryThemeData,
} from "./agent-observatory/hooks";
import { roleColor } from "./agent-observatory/theme";
import type { ActivityItem, AgentObservatoryProps } from "./agent-observatory/types";

export default function AgentObservatory(props: AgentObservatoryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const lastFeedTimestampRef = useRef<string | undefined>(undefined);
  const leaderRef = useRef<LeaderAssistantHandle>(null);
  const sceneRef = useObservatoryScene(containerRef, setLoading, setError);
  useObservatoryThemeData(props.activeTeamSessionKey, setTeamsData, setPresets);
  useObservatoryPolling(
    sceneRef,
    lastFeedTimestampRef,
    setAgents,
    setActivities,
  );
  useLeaderAssistantBridge(props.onWsEvent, leaderRef);

  // Derive leader info from teams data + active session key + agent summaries
  const leaderInfo = useMemo(() => {
    if (!teamsData) return null;
    return resolveLeaderInfo(
      teamsData,
      props.activeTeamSessionKey,
      agents,
      presets,
    );
  }, [teamsData, props.activeTeamSessionKey, agents, presets]);

  const teamOptions = useMemo(
    () =>
      buildTeamOptionsWithFallback(
        teamsData,
        presets,
        props.activeTeamSessionKey,
      ),
    [teamsData, presets, props.activeTeamSessionKey],
  );

  const leaderSummary = useMemo(() => {
    if (!leaderInfo) return undefined;
    return (
      agents.find((a) => a.id === leaderInfo.id) ??
      agents.find((a) => a.role === leaderInfo.role)
    );
  }, [agents, leaderInfo]);

  const totalScore = useMemo(
    () => agents.reduce((sum, agent) => sum + agent.total_score, 0),
    [agents],
  );

  const activityPreview = useMemo(() => activities.slice(0, 8), [activities]);

  const roleMatrix = useMemo(
    () => buildRoleMatrix(agents, teamsData?.theme),
    [agents, teamsData?.theme],
  );

  if (error) {
    return (
      <div className="observatory-error">
        <span style={{ fontSize: 32 }}>⚠️</span>
        <span>观测站加载失败</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{error}</span>
      </div>
    );
  }

  return (
    <div className="observatory">
      <div
        className="observatory-canvas"
        ref={containerRef}
        aria-hidden="true"
      />
      {loading && (
        <div className="observatory-loading">
          <span className="spinner" />
          <span>正在加载观测站…</span>
        </div>
      )}
      <div className="observatory-hud">
        <div className="observatory-top-bar">
          <div className="observatory-title-card">
            <div className="observatory-title-row">
              <div className="observatory-title">
                <span className="observatory-title-icon">
                  {teamsData?.theme?.icon ?? "🌌"}
                </span>
                <div className="observatory-title-copy">
                  <strong>{teamsData?.theme?.title ?? "观测站"}</strong>
                  <span>
                    World mode · Live team orchestration · Template-aware relay
                  </span>
                </div>
              </div>
              <span
                className={`observatory-conn-pill observatory-conn-pill--${props.connState}`}
              >
                <Radio size={13} />
                <span>{props.connState}</span>
              </span>
            </div>
            <div className="observatory-summary-strip">
              <span className="observatory-summary-chip">
                <Users size={13} />
                <span>{agents.length} 位智能体</span>
              </span>
              <span className="observatory-summary-chip">
                <Activity size={13} />
                <span>{activityPreview.length} 条即时活动</span>
              </span>
              <span className="observatory-summary-chip">
                <Workflow size={13} />
                <span>{totalScore} 总积分</span>
              </span>
            </div>
          </div>
          {teamOptions.length > 1 && (
            <div className="observatory-team-switch">
              <label>展示团队</label>
              <select
                className="observatory-team-select"
                value={props.activeTeamSessionKey}
                onChange={(e) => props.onTeamChange(e.target.value)}
                disabled={props.streaming}
              >
                {teamOptions.map((opt) => (
                  <option key={opt.sessionKey} value={opt.sessionKey}>
                    {opt.source === "preset" ? `🤖 ${opt.label}` : opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="observatory-sidepanel">
          <section className="observatory-panel observatory-panel--activity">
            <div className="observatory-panel-head">
              <strong>活动流</strong>
              <span>Live feed</span>
            </div>
            <div className="observatory-activity">
              {activityPreview.map((item) => (
                <div className="observatory-activity-item" key={item.id}>
                  <span
                    className="dot"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: roleColor(item.agentRole, teamsData?.theme),
                      flexShrink: 0,
                    }}
                  />
                  <span className="agent-name">{item.agentName}</span>
                  <span>{item.action}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="observatory-panel">
            <div className="observatory-panel-head">
              <strong>角色矩阵</strong>
              <span>Role mesh</span>
            </div>
            <div className="observatory-role-matrix">
              {roleMatrix.map((item) => (
                <div className="observatory-role-chip" key={item.role}>
                  <span
                    className="dot"
                    style={{ background: item.color, flexShrink: 0 }}
                  />
                  <strong>{item.label}</strong>
                  <span>{item.count} active</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="observatory-scorebar">
          {agents.map((a) => (
            <div className="observatory-score-chip" key={a.id}>
              <span
                className="dot"
                style={{ background: roleColor(a.role, teamsData?.theme) }}
              />
              <span>{a.name}</span>
              <span className="score">{a.total_score}</span>
            </div>
          ))}
        </div>
      </div>
      {leaderInfo && (
        <LeaderAssistant
          key={leaderInfo.sessionKey}
          ref={leaderRef}
          leaderName={leaderInfo.name}
          leaderRole={leaderInfo.role}
          leaderScore={leaderSummary?.total_score ?? 0}
          currentTask={leaderSummary?.current_sub_task?.name ?? null}
          onSend={props.onSend}
          onAbort={props.onAbort}
          streaming={props.streaming}
          connState={props.connState}
        />
      )}
    </div>
  );
}
