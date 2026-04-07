import { useCallback, useEffect, useState } from "react";
import { Bot, Menu, Plus } from "lucide-react";
import type { ChatMessage, StreamBlock } from "../types";
import { fetchAgentPresets, type AgentPreset } from "../lib/teams";
import {
  resolveSpritePackIdForWorkspace,
  subscribeSpritePackChanges,
} from "../lib/sprite-packs";
import useAgentExpression from "../hooks/useAgentExpression";
import ChatView from "./ChatView";
import Composer from "./Composer";
import SpriteAvatar from "./SpriteAvatar";
import ThreadListPanel from "./ThreadListPanel";

interface AgentModeViewProps {
  compact: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  workspace: {
    activeWorkspaceKey: string;
    activeThreadId: string | null;
    threads: Array<{ id: string; workspaceKey: string; title: string; updatedAt: number }>;
    switchWorkspace: (key: string) => void;
    selectThread: (id: string) => void;
    createThread: () => Promise<string | null>;
    deleteThread: (id: string) => Promise<void>;
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

export default function AgentModeView({
  compact,
  sidebarOpen,
  toggleSidebar,
  closeSidebar,
  workspace,
  conversation,
}: AgentModeViewProps) {
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [spriteExpanded, setSpriteExpanded] = useState(true);
  const [spritePackId, setSpritePackId] = useState(() =>
    resolveSpritePackIdForWorkspace(workspace.activeWorkspaceKey),
  );
  const agentExpression = useAgentExpression({
    streaming: conversation.streaming,
    blocks: conversation.blocks,
    error: conversation.error,
  });

  useEffect(() => {
    void fetchAgentPresets().then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setSpritePackId(resolveSpritePackIdForWorkspace(workspace.activeWorkspaceKey));
    sync();
    return subscribeSpritePackChanges(sync);
  }, [workspace.activeWorkspaceKey]);

  const handleCloseSidebar = useCallback(() => {
    if (compact && sidebarOpen) closeSidebar();
  }, [compact, sidebarOpen, closeSidebar]);

  return (
    <div className="agent-mode">
      <div className="agent-mode-topbar">
        {compact && (
          <button className="agent-topbar-btn" onClick={toggleSidebar} title="线程列表">
            <Menu size={16} />
          </button>
        )}
        <div className="agent-preset-strip">
          {presets.map((preset) => {
            const isActive = workspace.activeWorkspaceKey === preset.workspaceKey;
            return (
              <button
                key={preset.id}
                className={`agent-preset-tab${isActive ? " active" : ""}`}
                onClick={() => workspace.switchWorkspace(preset.workspaceKey)}
              >
                <Bot size={14} />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>
        <button className="agent-topbar-btn agent-topbar-btn--add" title="新建 Agent">
          <Plus size={16} />
        </button>
      </div>

      <div className="agent-mode-body">
        {compact && sidebarOpen && <div className="agent-sidebar-backdrop" onClick={handleCloseSidebar} />}

        <ThreadListPanel
          workspaceKey={workspace.activeWorkspaceKey}
          threads={workspace.threads}
          activeThreadId={workspace.activeThreadId}
          onSelect={workspace.selectThread}
          onCreate={() => void workspace.createThread()}
          onDelete={workspace.deleteThread}
          onWorkspaceChange={workspace.switchWorkspace}
          open={sidebarOpen}
          onClose={handleCloseSidebar}
        />

        <section className="agent-chat-area">
          {spriteExpanded && (
            <div className="agent-sprite-stage">
              <SpriteAvatar
                spritePackId={spritePackId}
                expression={agentExpression}
                size="lg"
                onToggle={() => setSpriteExpanded(false)}
              />
            </div>
          )}
          <div className="agent-chat-scroll">
            <ChatView
              messages={conversation.messages}
              blocks={conversation.blocks}
              streaming={conversation.streaming}
              error={conversation.error}
              activeWorkspaceKey={workspace.activeWorkspaceKey}
              agentSummaries={[]}
            />
          </div>
          <div className="agent-composer-zone">
            {!spriteExpanded && (
              <div className="agent-sprite-inline">
                <SpriteAvatar
                  spritePackId={spritePackId}
                  expression={agentExpression}
                  size="sm"
                  onToggle={() => setSpriteExpanded(true)}
                />
              </div>
            )}
            <Composer
              disabled={conversation.connState !== "connected"}
              streaming={conversation.streaming}
              onSend={conversation.send}
              onAbort={conversation.abort}
              agents={[]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
