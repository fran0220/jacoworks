import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { fetchAgentSummary, fetchFeedLogs } from "../lib/feed";
import type { AgentSummary, FeedLog } from "../lib/feed";
import type { WorldAgent } from "../observatory/types";
import { setRoleLabels } from "../lib/feed-translate";
import { fetchTeams } from "../lib/teams";
import type { TeamsResponse, TemplateTheme } from "../lib/teams";
import { buildTeamOptions, resolveLeaderInfo } from "../lib/team-utils";
import LeaderAssistant from "../observatory/hud/LeaderAssistant";
import type { LeaderAssistantHandle } from "../observatory/hud/LeaderAssistant";

const ROLE_OVERRIDES_GLOBAL_KEY = "__JACOWORKS_OBSERVATORY_ROLE_OVERRIDES__";
const ZONE_LABELS_GLOBAL_KEY = "__JACOWORKS_OBSERVATORY_ZONE_LABELS__";

interface ActivityItem {
  id: string;
  agentName: string;
  agentRole: string;
  action: string;
  timestamp: number;
}

function feedLogToActivity(log: FeedLog): ActivityItem {
  const ts = log.timestamp ? new Date(log.timestamp).getTime() : Date.now();
  let action = `${log.method} ${log.path}`;
  if (log.path.includes("submit")) action = "提交了任务";
  else if (log.path.includes("review")) action = "审核了任务";
  else if (log.path.includes("claim")) action = "领取了任务";
  else if (log.path.includes("score")) action = "得分变更";
  else if (log.path.includes("task")) action = "处理任务";
  return {
    id: log.id,
    agentName: log.agent_name || "未知",
    agentRole: log.agent_role || "agent",
    action,
    timestamp: ts,
  };
}

const DEFAULT_ROLE_COLORS: Record<string, string> = {
  planner: "#3b82f6",
  executor: "#f97316",
  reviewer: "#22c55e",
  patrol: "#a855f7",
};

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return ((hash % 360) + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function roleColor(role: string, theme?: TemplateTheme): string {
  const themedColor = theme?.roles?.[role]?.color;
  if (themedColor) return themedColor;
  return DEFAULT_ROLE_COLORS[role] ?? hslToHex(hashStringToHue(role), 0.7, 0.55);
}

function setObservatoryRoleOverrides(overrides: Record<string, { color: number; emissive: number; namePrefix: string }> | null): void {
  const globalState = globalThis as Record<string, unknown>;
  globalState[ROLE_OVERRIDES_GLOBAL_KEY] = overrides;
}

function setObservatoryZoneLabels(labels: Record<string, string> | null): void {
  const globalState = globalThis as Record<string, unknown>;
  globalState[ZONE_LABELS_GLOBAL_KEY] = labels;
}

interface SceneRefs {
  scene: InstanceType<typeof import("../observatory/world/ObservatoryScene").ObservatoryScene>;
  env: { update(time: number): void };
  zones: InstanceType<typeof import("../observatory/world/ZoneManager").ZoneManager>;
  pool: InstanceType<typeof import("../observatory/avatar/AvatarPool").AvatarPool>;
  factory: InstanceType<typeof import("../observatory/avatar/AvatarFactory").AvatarFactory>;
  waypointGraph: InstanceType<typeof import("../observatory/world/WaypointGraph").WaypointGraph>;
  stateManager: InstanceType<typeof import("../observatory/bridge/AgentStateManager").AgentStateManager>;
  eventBridge: InstanceType<typeof import("../observatory/bridge/EventBridge").EventBridge>;
  worldAgents: Map<string, WorldAgent>;
  navigators: Map<string, InstanceType<typeof import("../observatory/avatar/AvatarNavigator").AvatarNavigator>>;
  animators: Map<string, InstanceType<typeof import("../observatory/avatar/AvatarAnimator").AvatarAnimator>>;
}

interface AgentObservatoryProps {
  onWsEvent?: React.MutableRefObject<((event: { kind: string; text?: string; toolName?: string }) => void) | null>;
  activeTeamSessionKey: string;
  onTeamChange: (sessionKey: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  connState: "disconnected" | "connecting" | "connected";
}

export default function AgentObservatory(props: AgentObservatoryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);
  const lastLogIdRef = useRef<string | undefined>(undefined);
  const sceneRef = useRef<SceneRefs | null>(null);
  const leaderRef = useRef<LeaderAssistantHandle>(null);
  const appliedThemeRef = useRef<string | null>(null);

  // Apply theme overrides to observatory types and feed labels
  const applyTheme = useCallback((theme: TemplateTheme | undefined) => {
    const themeKey = theme?.sceneKind ?? "default";
    if (appliedThemeRef.current === themeKey) return;
    appliedThemeRef.current = themeKey;

    if (theme) {
      // Apply role color overrides
      if (theme.roles) {
        const overrides: Record<string, { color: number; emissive: number; namePrefix: string }> = {};
        for (const [role, cfg] of Object.entries(theme.roles)) {
          const hex = parseInt(cfg.color.replace("#", ""), 16);
          const darkerHex = Math.floor(hex * 0.6);
          overrides[role] = { color: hex, emissive: darkerHex, namePrefix: cfg.displayName.slice(0, 1) };
        }
        setObservatoryRoleOverrides(overrides);
      }
      // Apply zone label overrides
      if (theme.zones) {
        const labels: Record<string, string> = {};
        for (const [zoneId, cfg] of Object.entries(theme.zones)) {
          labels[zoneId] = cfg.label;
        }
        setObservatoryZoneLabels(labels);
      }
      // Apply feed role labels
      if (theme.roles) {
        const labels: Record<string, string> = {};
        for (const [role, cfg] of Object.entries(theme.roles)) {
          labels[role] = cfg.displayName;
        }
        setRoleLabels(labels);
      }
    } else {
      setObservatoryRoleOverrides(null);
      setObservatoryZoneLabels(null);
      setRoleLabels(null as unknown as Record<string, string>);
    }
  }, []);

  // Fetch teams data (re-fetch when team changes)
  const loadTeams = useCallback(async () => {
    try {
      const data = await fetchTeams();
      setTeamsData(data);
      applyTheme(data.theme);
    } catch {
      // silent
    }
  }, [applyTheme]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams, props.activeTeamSessionKey]);

  // Derive leader info from teams data + active session key + agent summaries
  const leaderInfo = useMemo(() => {
    if (!teamsData) return null;
    return resolveLeaderInfo(teamsData, props.activeTeamSessionKey, agents);
  }, [teamsData, props.activeTeamSessionKey, agents]);

  // Build team selector options
  const teamOptions = useMemo(() => {
    if (!teamsData) return [];
    return buildTeamOptions(teamsData);
  }, [teamsData]);

  const leaderSummary = useMemo(() => {
    if (!leaderInfo) return undefined;
    return (
      agents.find((a) => a.id === leaderInfo.id) ??
      agents.find((a) => a.role === leaderInfo.role)
    );
  }, [agents, leaderInfo]);

  const initScene = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      const [
        { ObservatoryScene },
        { ZoneManager },
        { WaypointGraph },
        { AvatarPool },
        { AvatarFactory },
        { AvatarNavigator },
        { AvatarAnimator },
        { EventBridge },
        { AgentStateManager },
      ] = await Promise.all([
        import("../observatory/world/ObservatoryScene"),
        import("../observatory/world/ZoneManager"),
        import("../observatory/world/WaypointGraph"),
        import("../observatory/avatar/AvatarPool"),
        import("../observatory/avatar/AvatarFactory"),
        import("../observatory/avatar/AvatarNavigator"),
        import("../observatory/avatar/AvatarAnimator"),
        import("../observatory/bridge/EventBridge"),
        import("../observatory/bridge/AgentStateManager"),
      ]);

      const scene = new ObservatoryScene();
      const threeScene = scene.getScene();

      const { IslandEnvironment } = await import("../observatory/world/IslandEnvironment");
      const env = new IslandEnvironment(threeScene);

      const zones = new ZoneManager(threeScene);
      const waypointGraph = new WaypointGraph();
      const pool = new AvatarPool();

      await pool.loadBaseModels();

      const factory = new AvatarFactory(pool, threeScene);
      const worldAgents = new Map<string, WorldAgent>();
      const navigators = new Map<string, InstanceType<typeof AvatarNavigator>>();
      const animators = new Map<string, InstanceType<typeof AvatarAnimator>>();

      const stateManager = new AgentStateManager(worldAgents, zones, waypointGraph);

      const eventBridge = new EventBridge((event) => {
        stateManager.handleEvent(event);
      });

      let elapsed = 0;
      scene.setOnUpdate((delta) => {
        elapsed += delta;
        env.update(elapsed);
        zones.update(elapsed);
        stateManager.update(delta);

        // Move agents along their walk paths
        for (const [id, nav] of navigators) {
          const agent = worldAgents.get(id);
          if (!agent) continue;

          // Feed pending walkPath from state manager to navigator
          if (agent.walkPath.length > 0 && !nav.isMoving()) {
            nav.setDestination(agent.walkPath);
            agent.walkPath = [];
            agent.state = "walking";
          }

          const moving = nav.update(delta);
          if (!moving && agent.state === "walking") {
            agent.state = "idle";
          }
        }

        // Update agent animators + sync root position
        for (const [id, animator] of animators) {
          const agent = worldAgents.get(id);
          if (!agent) continue;
          animator.setState(agent.state);
          animator.update(delta);
          // Sync 3D root position for non-VRM fallback agents
          // (VRM agents are synced by AvatarNavigator via vrm.scene)
          if (!agent.vrm) {
            agent.root.position.copy(agent.position);
          }
        }
      });

      scene.mount(containerRef.current);
      sceneRef.current = { scene, env, zones, pool, factory, waypointGraph, stateManager, eventBridge, worldAgents, navigators, animators };
      setLoading(false);
    } catch (err) {
      console.error("Observatory init failed:", err);
      setError(err instanceof Error ? err.message : "初始化失败");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initScene();
    return () => {
      sceneRef.current?.scene.dispose();
      sceneRef.current = null;
    };
  }, [initScene]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      sceneRef.current?.scene.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Poll agent summary every 5s — sync 3D agents
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchAgentSummary();
        if (cancelled) return;
        setAgents(data);

        const refs = sceneRef.current;
        if (!refs) return;

        const { factory, worldAgents, navigators, animators } = refs;
        const summaries = data.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          total_score: a.total_score,
          current_sub_task: a.current_sub_task,
        }));

        const { added, removed } = await factory.syncAgents(summaries, worldAgents);

        // Create navigators + animators for new agents
        const [{ AvatarNavigator }, { AvatarAnimator }] = await Promise.all([
          import("../observatory/avatar/AvatarNavigator"),
          import("../observatory/avatar/AvatarAnimator"),
        ]);
        for (const agent of added) {
          navigators.set(agent.id, new AvatarNavigator(agent));
          animators.set(agent.id, new AvatarAnimator(agent.vrm, agent.root));
        }

        // Cleanup removed
        for (const agent of removed) {
          navigators.delete(agent.id);
          animators.delete(agent.id);
        }
      } catch {
        // silent
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Poll feed logs incrementally every 5s
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const logs = await fetchFeedLogs(lastLogIdRef.current, undefined, 20);
        if (cancelled || logs.length === 0) return;
        lastLogIdRef.current = logs[logs.length - 1].id;
        const newItems = logs.map(feedLogToActivity);
        setActivities((prev) => [...newItems, ...prev].slice(0, 50));

        // Feed events to the 3D world bridge
        sceneRef.current?.eventBridge.feedNewLogs(logs);
      } catch {
        // silent
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Wire WS events to LeaderAssistant
  useEffect(() => {
    if (!props.onWsEvent) return;
    props.onWsEvent.current = (event) => {
      const ref = leaderRef.current;
      if (!ref) return;
      switch (event.kind) {
        case "thinking_start": ref.onThinkingStart(); break;
        case "thinking_delta": ref.onThinkingDelta(event.text || ""); break;
        case "text_delta": ref.onTextDelta(event.text || ""); break;
        case "tool_start": ref.onToolStart(event.toolName || "tool"); break;
        case "tool_end": ref.onToolEnd(event.toolName || "tool"); break;
        case "done": ref.onDone(); break;
      }
    };
    return () => { if (props.onWsEvent) props.onWsEvent.current = null; };
  }, [props.onWsEvent]);

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
      <div className="observatory-canvas" ref={containerRef} aria-hidden="true" />
      {loading && (
        <div className="observatory-loading">
          <span className="spinner" />
          <span>正在加载观测站…</span>
        </div>
      )}
      <div className="observatory-hud">
        {/* Top-left: title + agent count + team selector */}
        <div className="observatory-top-bar">
          <div className="observatory-title">
            {teamsData?.theme?.icon ?? "🌌"} {teamsData?.theme?.title ?? "观测站"}
            <span className="badge">{agents.length} 位智能体</span>
          </div>
          {teamOptions.length > 1 && (
            <select
              className="observatory-team-select"
              value={props.activeTeamSessionKey}
              onChange={(e) => props.onTeamChange(e.target.value)}
              disabled={props.streaming}
            >
              {teamOptions.map((opt) => (
                <option key={opt.sessionKey} value={opt.sessionKey}>
                  {opt.source === "installed" ? `👥 ${opt.label}` : opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Right: mini activity log */}
        <div className="observatory-activity">
          {activities.slice(0, 10).map((item) => (
            <div className="observatory-activity-item" key={item.id}>
              <span
                className="dot"
                style={{ width: 6, height: 6, borderRadius: "50%", background: roleColor(item.agentRole, teamsData?.theme), flexShrink: 0 }}
              />
              <span className="agent-name">{item.agentName}</span>
              <span>{item.action}</span>
            </div>
          ))}
        </div>

        {/* Bottom: score bar */}
        <div className="observatory-scorebar">
          {agents.map((a) => (
            <div className="observatory-score-chip" key={a.id}>
              <span className="dot" style={{ background: roleColor(a.role, teamsData?.theme) }} />
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
