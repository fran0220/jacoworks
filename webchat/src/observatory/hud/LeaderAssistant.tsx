import { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from "react";
import SpeechBubble from "./SpeechBubble";
import type { LeaderBubble, LeaderWsState } from "./LeaderDriver";
import { getRoleConfig } from "../types";

export interface LeaderAssistantHandle {
  onUserSend: () => void;
  onThinkingStart: () => void;
  onThinkingDelta: (text: string) => void;
  onTextDelta: (text: string) => void;
  onToolStart: (toolName: string) => void;
  onToolEnd: (toolName: string) => void;
  onDone: () => void;
}

interface LeaderAssistantProps {
  leaderName: string;
  leaderRole: string;
  leaderScore: number;
  currentTask: string | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  connState: "disconnected" | "connecting" | "connected";
}

interface SceneModules {
  scene: InstanceType<typeof import("./LeaderScene").LeaderScene>;
  driver: InstanceType<typeof import("./LeaderDriver").LeaderDriver>;
}

const LeaderAssistant = forwardRef<LeaderAssistantHandle, LeaderAssistantProps>(
  function LeaderAssistant({ leaderName, leaderRole, leaderScore, currentTask, onSend, onAbort, streaming, connState }, ref) {
    const [collapsed, setCollapsed] = useState(false);
    const [bubble, setBubble] = useState<LeaderBubble>({ text: "", type: "info" });
    const [, setWsState] = useState<LeaderWsState>("idle");
    const [draft, setDraft] = useState("");
    const canvasRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isComposingRef = useRef(false);
    const modulesRef = useRef<SceneModules | null>(null);

    const syncBubble = useCallback(() => {
      const driver = modulesRef.current?.driver;
      if (!driver) return;
      setBubble({ ...driver.getBubble() });
      setWsState(driver.getState());
    }, []);

    useEffect(() => {
      if (collapsed || !canvasRef.current) return;
      let disposed = false;
      const el = canvasRef.current;

      (async () => {
        const [{ LeaderScene }, { LeaderDriver }, { AvatarPool }] = await Promise.all([
          import("./LeaderScene"),
          import("./LeaderDriver"),
          import("../avatar/AvatarPool"),
        ]);

        if (disposed) return;

        const scene = new LeaderScene();
        scene.mount(el);

        const pool = new AvatarPool();
        pool.loadBaseModels().catch(() => {});

        const driver = new LeaderDriver(() => scene.getAnimator());
        modulesRef.current = { scene, driver };

        scene.loadLeader(pool, leaderRole).catch(() => {});
      })();

      const ro = new ResizeObserver(() => modulesRef.current?.scene.resize());
      ro.observe(el);

      return () => {
        disposed = true;
        ro.disconnect();
        modulesRef.current?.scene.dispose();
        modulesRef.current = null;
      };
    }, [collapsed, leaderRole]);

    useImperativeHandle(ref, () => ({
      onUserSend() {
        modulesRef.current?.driver.onUserSend();
        syncBubble();
      },
      onThinkingStart() {
        modulesRef.current?.driver.onThinkingStart();
        syncBubble();
      },
      onThinkingDelta(text: string) {
        modulesRef.current?.driver.onThinkingDelta(text);
        syncBubble();
      },
      onTextDelta(text: string) {
        modulesRef.current?.driver.onTextDelta(text);
        syncBubble();
      },
      onToolStart(toolName: string) {
        modulesRef.current?.driver.onToolStart(toolName);
        syncBubble();
      },
      onToolEnd(toolName: string) {
        modulesRef.current?.driver.onToolEnd(toolName);
        syncBubble();
      },
      onDone() {
        modulesRef.current?.driver.onDone();
        syncBubble();
      },
    }), [syncBubble]);

    const handleSubmit = useCallback(() => {
      const text = draft.trim();
      if (!text || connState !== "connected" || streaming) return;
      setDraft("");
      modulesRef.current?.driver.onUserSend();
      syncBubble();
      onSend(text);
    }, [draft, connState, streaming, onSend, syncBubble]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (!streaming) handleSubmit();
        }
      },
      [streaming, handleSubmit],
    );

    const roleColor = `#${getRoleConfig(leaderRole).color.toString(16).padStart(6, "0")}`;

    if (collapsed) {
      return (
        <div className="leader-assistant leader-assistant--collapsed">
          <button className="leader-toggle-btn" onClick={() => setCollapsed(false)} title="展开助手">
            🗨
          </button>
        </div>
      );
    }

    return (
      <div className="leader-assistant">
        <SpeechBubble
          text={bubble.text}
          type={bubble.type}
          leaderName={leaderName}
          leaderRole={leaderRole}
          visible={!!bubble.text}
        />
        <div className="leader-canvas-wrap" ref={canvasRef}>
          <button className="leader-collapse-btn" onClick={() => setCollapsed(true)} title="折叠">
            −
          </button>
        </div>
        <div className="leader-status-bar">
          <span className="role-dot" style={{ background: roleColor }} />
          <span className="leader-name">{leaderName}</span>
          <span className="score">🏆 {leaderScore}</span>
          <span className="task">{currentTask ? `📋 ${currentTask}` : "待命"}</span>
        </div>
        <div className="leader-composer">
          <textarea
            ref={inputRef}
            className="leader-composer-input"
            placeholder={`对 ${leaderName} 说...`}
            rows={1}
            value={draft}
            disabled={connState !== "connected"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
          />
          {streaming ? (
            <button className="leader-composer-abort" onClick={onAbort}>停止</button>
          ) : (
            <button
              className="leader-composer-send"
              disabled={connState !== "connected" || !draft.trim()}
              onClick={handleSubmit}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    );
  },
);

export default LeaderAssistant;
