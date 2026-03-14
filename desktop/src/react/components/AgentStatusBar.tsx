import { useEffect, useState } from "react";
import type { AgentPhase, ContextUsage } from "../lib/chat-stream-store";

const phaseLabels: Record<AgentPhase, string> = {
  idle: "",
  thinking: "思考中",
  executing: "执行中",
  compacting: "压缩上下文",
  retrying: "重试中",
};

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return <span className="asb-elapsed">{min > 0 ? `${min}m${sec}s` : `${sec}s`}</span>;
}

export default function AgentStatusBar({
  streaming,
  streamingStartedAt,
  agentPhase,
  turnCount,
  contextUsage,
}: {
  streaming: boolean;
  streamingStartedAt: number | null;
  agentPhase: AgentPhase;
  turnCount: number;
  contextUsage: ContextUsage | null;
}) {
  if (!streaming) return null;

  const label = phaseLabels[agentPhase] || phaseLabels.thinking;
  const pct = contextUsage
    ? Math.min(Math.round((contextUsage.usedTokens / contextUsage.maxTokens) * 100), 100)
    : null;

  return (
    <div className="agent-status-bar">
      {/* Phase indicator with pulse */}
      <span className={`asb-phase asb-phase--${agentPhase}`}>
        <span className="asb-dot" />
        <span className="asb-label">{label}</span>
      </span>

      {/* Turn count */}
      {turnCount > 0 && (
        <span className="asb-meta">
          轮次 <span className="asb-num">{turnCount}</span>
        </span>
      )}

      {/* Elapsed time */}
      {streamingStartedAt && <ElapsedTimer startedAt={streamingStartedAt} />}

      {/* Context usage bar */}
      {pct !== null && (
        <span className="asb-context">
          <span className="asb-context-track">
            <span
              className={`asb-context-fill${pct > 80 ? " asb-context-warn" : ""}`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="asb-context-pct">{pct}%</span>
        </span>
      )}
    </div>
  );
}
