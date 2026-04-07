import { useEffect, useState } from "react";
import { type UseUIShellResult } from "../hooks/useUIShell";
import { type UseWorkspaceResult } from "../hooks/useWorkspace";
import { type UseConversationResult } from "../hooks/use-conversation/types";
import { type UseOperationsResult } from "../hooks/useOperations";

type OpsLens = "overview" | "timeline" | "board";
import {
  resolveSpritePackIdForWorkspace,
  subscribeSpritePackChanges,
} from "../lib/sprite-packs";
import useAgentExpression from "../hooks/useAgentExpression";
import ThreadListPanel from "./ThreadListPanel";
import TeamPresenceBar from "./TeamPresenceBar";
import ChatView from "./ChatView";
import Composer from "./Composer";
import SpriteAvatar from "./SpriteAvatar";
import OpsSidebar from "./ops-sidebar/OpsSidebar";

interface WorkbenchViewProps {
  ui: UseUIShellResult;
  workspace: UseWorkspaceResult;
  conversation: UseConversationResult;
  ops: UseOperationsResult;
}

export default function WorkbenchView({ ui, workspace, conversation, ops }: WorkbenchViewProps) {
  const [opsLens, setOpsLens] = useState<OpsLens>("overview");
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
    const sync = () => setSpritePackId(resolveSpritePackIdForWorkspace(workspace.activeWorkspaceKey));
    sync();
    return subscribeSpritePackChanges(sync);
  }, [workspace.activeWorkspaceKey]);

  return (
    <div className="workbench">
      {/* 左栏: 线程 */}
      <ThreadListPanel
        workspaceKey={workspace.activeWorkspaceKey}
        threads={workspace.threads}
        activeThreadId={workspace.activeThreadId}
        onSelect={workspace.selectThread}
        onCreate={() => void workspace.createThread()}
        onDelete={workspace.deleteThread}
        onWorkspaceChange={workspace.switchWorkspace}
        open={ui.sidebarOpen}
        onClose={ui.closeSidebar}
      />

      {/* 中栏: 群聊 */}
      <div className="workbench-center">
        <TeamPresenceBar agents={ops.agentSummaries} />

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
              agentSummaries={ops.agentSummaries}
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
              agents={ops.agentSummaries}   // for @mention
            />
          </div>
        </section>
      </div>

      {/* 右栏: 运营 (桌面端) */}
      {!ui.compact && (
        <OpsSidebar
          lens={opsLens}
          onLensChange={setOpsLens}
          ops={ops}
          onAgentClick={(id) => ops.selectAgent(id)}
        />
      )}
    </div>
  );
}
