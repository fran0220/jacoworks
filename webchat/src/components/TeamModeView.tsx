import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Loader, Plus, Users } from "lucide-react";
import type { ChatMessage, StreamBlock } from "../types";
import {
  createTeamWorkspace,
  fetchTeams,
  type TeamTemplate,
} from "../lib/teams";
import { matchesTemplateSessionKey } from "../lib/team-utils";
import useOperations from "../hooks/useOperations";
import ChatView from "./ChatView";
import Composer from "./Composer";
import TeamPresenceBar from "./TeamPresenceBar";
import CrewProgressBar from "./CrewProgressBar";

const VillageScene = lazy(() => import("../village/VillageScene"));

interface TeamModeViewProps {
  workspace: {
    activeWorkspaceKey: string;
    switchWorkspace: (key: string) => void;
  };
  conversation: {
    messages: ChatMessage[];
    blocks: StreamBlock[];
    streaming: boolean;
    error: string | null;
    connState: "disconnected" | "connecting" | "connected";
    send: (text: string) => void | Promise<void>;
    abort: () => void;
  };
}

export default function TeamModeView({
  workspace,
  conversation,
}: TeamModeViewProps) {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const ops = useOperations(workspace.activeWorkspaceKey);

  const activeTemplate = useMemo(
    () => templates.find((t) => matchesTemplateSessionKey(t, workspace.activeWorkspaceKey)) ?? null,
    [templates, workspace.activeWorkspaceKey],
  );

  const displayTemplate = activeTemplate ?? templates[0] ?? null;

  useEffect(() => {
    void fetchTeams()
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const [launchedKeys] = useState(() => new Map<string, string>());

  const handleLaunchTeam = useCallback(
    async (template: TeamTemplate) => {
      if (matchesTemplateSessionKey(template, workspace.activeWorkspaceKey)) return;

      const cached = launchedKeys.get(template.id);
      if (cached) {
        workspace.switchWorkspace(cached);
        return;
      }

      setLaunching(template.id);
      try {
        const created = await createTeamWorkspace(template.id);
        launchedKeys.set(template.id, created.workspaceKey);
        workspace.switchWorkspace(created.workspaceKey);
      } catch {
        // ignore
      } finally {
        setLaunching(null);
      }
    },
    [launchedKeys, workspace],
  );

  return (
    <div className="team-mode">
      <div className="team-mode-topbar">
        <div className="team-template-strip">
          {templates.map((template) => {
            const isActive = matchesTemplateSessionKey(template, workspace.activeWorkspaceKey);
            const isLaunching = launching === template.id;
            return (
              <button
                key={template.id}
                className={`team-tab${isActive ? " active" : ""}`}
                onClick={() => void handleLaunchTeam(template)}
                disabled={isLaunching}
              >
                <span aria-hidden="true">{template.icon || "👥"}</span>
                <span>{template.label}</span>
                {isLaunching && <Loader size={12} className="spin-icon" />}
              </button>
            );
          })}
          {loading && <Loader size={14} className="spin-icon" />}
        </div>
        <button className="team-topbar-btn" title="新建团队">
          <Plus size={16} />
        </button>
      </div>

      <div className="team-mode-body">
        <section className="team-chat-side">
          {ops.agentSummaries.length > 0 && (
            <TeamPresenceBar agents={ops.agentSummaries} />
          )}
          <div className="team-chat-scroll">
            <ChatView
              messages={conversation.messages}
              blocks={conversation.blocks}
              streaming={conversation.streaming}
              error={conversation.error}
              activeWorkspaceKey={workspace.activeWorkspaceKey}
              agentSummaries={ops.agentSummaries}
            />
          </div>
          <Composer
            disabled={conversation.connState !== "connected"}
            streaming={conversation.streaming}
            onSend={conversation.send}
            onAbort={conversation.abort}
            agents={ops.agentSummaries}
          />
        </section>

        <section className="team-village-side">
          {displayTemplate ? (
            <Suspense fallback={<div className="team-village-loading">搭建小镇中…</div>}>
              <VillageScene
                template={displayTemplate}
                activeSessionKey={workspace.activeWorkspaceKey}
                onBack={() => {}}
                onLaunchTeam={handleLaunchTeam}
                variant="inline"
              />
            </Suspense>
          ) : (
            <div className="team-village-empty">
              <Users size={32} strokeWidth={1.5} />
              <p>{loading ? "加载团队模板…" : "暂无团队模板"}</p>
            </div>
          )}
          {ops.crewTasks.length > 0 && <CrewProgressBar tasks={ops.crewTasks} />}
        </section>
      </div>
    </div>
  );
}
