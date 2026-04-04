import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "./types";
import { DEFAULT_OPENCLAW_SESSION_KEY, getOpenClawToken } from "./lib/config";
import { fetchTeams, type TeamsResponse } from "./lib/teams";
import { getTemplateSessionKey } from "./lib/team-utils";
import NavRail from "./components/NavRail";
import SetupGate from "./components/SetupGate";
import AgentView from "./components/AgentView";
import TeamChannelView from "./components/TeamChannelView";
import DashboardView from "./components/DashboardView";
import CreateAgentModal from "./components/CreateAgentModal";
import InstallTeamModal from "./components/InstallTeamModal";

const ObserveView = lazy(() => import("./components/ObserveView"));

function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return compact;
}

function buildChannels(data: TeamsResponse): Channel[] {
  const channels: Channel[] = [];

  channels.push({
    id: "dashboard",
    kind: "dashboard",
    sessionKey: "",
    label: "仪表盘",
    icon: "home",
  });

  // Default agent
  channels.push({
    id: "agent:default",
    kind: "agent",
    sessionKey: DEFAULT_OPENCLAW_SESSION_KEY,
    label: "亦城",
    icon: "bot",
  });

  // Agent profiles
  for (const profile of data.profiles) {
    channels.push({
      id: `agent:${profile.name}`,
      kind: "agent",
      sessionKey: profile.sessionKey,
      label: profile.displayName,
      icon: profile.icon,
      profileName: profile.name,
    });
  }

  // Installed teams
  for (const template of data.available) {
    if (template.name !== data.installed) continue;
    channels.push({
      id: `team:${template.name}`,
      kind: "team",
      sessionKey: getTemplateSessionKey(template),
      label: template.displayName,
      templateName: template.name,
      agentCount: template.agents.length,
    });
  }

  channels.push({
    id: "observe",
    kind: "observe",
    sessionKey: "",
    label: "观测",
    icon: "orbit",
  });

  return channels;
}

type ConnectionState = "disconnected" | "connecting" | "connected";

export default function App() {
  const [ocToken, setOcToken] = useState<string | null>(() => getOpenClawToken() || null);
  const [activeChannelId, setActiveChannelId] = useState("dashboard");
  const [channels, setChannels] = useState<Channel[]>(() =>
    buildChannels({ installed: "", activeSessionKey: DEFAULT_OPENCLAW_SESSION_KEY, available: [], profiles: [] }),
  );
  const [connState, setConnState] = useState<ConnectionState>("disconnected");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showInstallTeam, setShowInstallTeam] = useState(false);
  const [teamsData, setTeamsData] = useState<TeamsResponse | null>(null);
  const compact = useCompact();
  const observatoryEventRef = useRef<((event: { kind: string; text?: string; toolName?: string }) => void) | null>(null);

  const refreshChannels = useCallback(() => {
    fetchTeams()
      .then((data) => {
        setTeamsData(data);
        setChannels(buildChannels(data));
      })
      .catch(() => {});
  }, []);

  // Fetch channels on mount
  useEffect(() => {
    refreshChannels();
  }, [refreshChannels]);

  // Simple WS connection probe — only for the connState dot in NavRail.
  // Actual conversation WS is managed inside AgentView/TeamChannelView.
  useEffect(() => {
    if (!ocToken) {
      setConnState("disconnected");
      return;
    }
    setConnState("connected");
  }, [ocToken]);

  const handleGateReady = useCallback((token: string) => {
    window.__OPENCLAW_TOKEN__ = token;
    setOcToken(token);
  }, []);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  if (!ocToken) {
    return <SetupGate onReady={handleGateReady} />;
  }

  return (
    <div className="app-layout">
      <NavRail
        channels={channels}
        activeChannelId={activeChannelId}
        onChannelChange={(id) => {
          setActiveChannelId(id);
          setMobileDrawerOpen(false);
        }}
        onCreateAgent={() => setShowCreateAgent(true)}
        onCreateTeam={() => setShowInstallTeam(true)}
        compact={compact}
        connState={connState}
        mobileDrawerOpen={mobileDrawerOpen}
        onCloseMobileDrawer={() => setMobileDrawerOpen(false)}
      />
      <div className="app-main">
        {activeChannel?.kind === "dashboard" && (
          <DashboardView
            agents={channels
              .filter((c) => c.kind === "agent")
              .map((c) => ({ sessionKey: c.sessionKey, name: c.profileName || "default", displayName: c.label, icon: c.icon || "bot" }))}
            teams={channels
              .filter((c) => c.kind === "team")
              .map((c) => ({ sessionKey: c.sessionKey, name: c.templateName || "", displayName: c.label, agentCount: c.agentCount || 0 }))}
            connState={connState}
            onSelectChannel={(sessionKey) => {
              const ch = channels.find((c) => c.sessionKey === sessionKey);
              if (ch) setActiveChannelId(ch.id);
            }}
            onCreateAgent={() => setShowCreateAgent(true)}
            onCreateTeam={() => setShowInstallTeam(true)}
          />
        )}
        {activeChannel?.kind === "agent" && (
          <AgentView
            key={activeChannel.id}
            sessionKey={activeChannel.sessionKey}
            profileName={activeChannel.profileName || ""}
            displayName={activeChannel.label}
            icon={activeChannel.icon}
            ocToken={ocToken}
          />
        )}
        {activeChannel?.kind === "team" && (
          <TeamChannelView
            key={activeChannel.id}
            sessionKey={activeChannel.sessionKey}
            templateName={activeChannel.templateName || ""}
            displayName={activeChannel.label}
            ocToken={ocToken}
          />
        )}
        {activeChannel?.kind === "observe" && (
          <Suspense fallback={<div className="observe-placeholder">加载观测站…</div>}>
            <ObserveView
              observatoryEventRef={observatoryEventRef}
              activeTeamSessionKey={DEFAULT_OPENCLAW_SESSION_KEY}
              onTeamChange={() => {}}
              onSend={() => {}}
              onAbort={() => {}}
              streaming={false}
              connState={connState}
            />
          </Suspense>
        )}
      </div>
      {compact && activeChannel?.kind !== "dashboard" && (
        <button className="mobile-fab-nav" onClick={() => setMobileDrawerOpen(true)} title="导航菜单">
          <span>J</span>
        </button>
      )}
      <CreateAgentModal
        open={showCreateAgent}
        onClose={() => setShowCreateAgent(false)}
        onCreated={refreshChannels}
      />
      <InstallTeamModal
        open={showInstallTeam}
        onClose={() => setShowInstallTeam(false)}
        onInstalled={refreshChannels}
        available={teamsData?.available ?? []}
        installed={teamsData?.installed ?? ""}
      />
    </div>
  );
}
