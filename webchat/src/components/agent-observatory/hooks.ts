import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { fetchAgentSummary, fetchFeedLogs, type AgentSummary, type FeedLog } from "../../lib/feed";
import { fetchAgentPresets, fetchTeams, type AgentPreset, type TeamsResponse } from "../../lib/teams";
import { matchesTemplateSessionKey } from "../../lib/team-utils";
import type { LeaderAssistantHandle } from "../../observatory/hud/LeaderAssistant";
import { feedLogToActivity } from "./activity";
import { createObservatoryScene, syncSceneAgents } from "./scene";
import { applyObservatoryTheme } from "./theme";
import type { ActivityItem, SceneRefs, WsBridgeEvent } from "./types";

export function useObservatoryThemeData(
  activeTeamSessionKey: string,
  setTeamsData: Dispatch<SetStateAction<TeamsResponse | null>>,
  setPresets: Dispatch<SetStateAction<AgentPreset[]>>,
) {
  const appliedThemeRef = useRef<string | null>(null);

  const loadTeams = useCallback(async () => {
    try {
      const [data, agentPresets] = await Promise.all([
        fetchTeams(),
        fetchAgentPresets(),
      ]);
      setTeamsData(data);
      setPresets(agentPresets);
      const activeTemplate = data.templates.find((template) =>
        matchesTemplateSessionKey(template, activeTeamSessionKey),
      );
      applyObservatoryTheme(activeTemplate?.theme ?? data.theme, appliedThemeRef);
    } catch {
      // silent
    }
  }, [activeTeamSessionKey, setPresets, setTeamsData]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams, activeTeamSessionKey]);
}

export function useObservatoryScene(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  setLoading: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  const sceneRef = useRef<SceneRefs | null>(null);

  const initScene = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      sceneRef.current = await createObservatoryScene(containerRef.current);
      setLoading(false);
    } catch (err) {
      console.error("Observatory init failed:", err);
      setError(err instanceof Error ? err.message : "初始化失败");
      setLoading(false);
    }
  }, [containerRef, setError, setLoading]);

  useEffect(() => {
    void initScene();
    return () => {
      sceneRef.current?.scene.dispose();
      sceneRef.current = null;
    };
  }, [initScene]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      sceneRef.current?.scene.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return sceneRef;
}

export function useObservatoryPolling(
  sceneRef: MutableRefObject<SceneRefs | null>,
  lastFeedTimestampRef: MutableRefObject<string | undefined>,
  setAgents: Dispatch<SetStateAction<AgentSummary[]>>,
  setActivities: Dispatch<SetStateAction<ActivityItem[]>>,
) {
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchAgentSummary();
        if (cancelled) return;
        setAgents(data);

        const refs = sceneRef.current;
        if (!refs) return;
        await syncSceneAgents(refs, data);
      } catch {
        // silent
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sceneRef, setAgents]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const logs: FeedLog[] = await fetchFeedLogs(
          lastFeedTimestampRef.current,
          undefined,
          20,
        );
        if (cancelled || logs.length === 0) return;
        lastFeedTimestampRef.current = logs[0]?.timestamp ?? lastFeedTimestampRef.current;
        const newItems = logs.map(feedLogToActivity);
        setActivities((prev) => [...newItems, ...prev].slice(0, 50));
        sceneRef.current?.eventBridge.feedNewLogs(logs);
      } catch {
        // silent
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lastFeedTimestampRef, sceneRef, setActivities]);
}

export function useLeaderAssistantBridge(
  onWsEvent: MutableRefObject<((event: WsBridgeEvent) => void) | null> | undefined,
  leaderRef: MutableRefObject<LeaderAssistantHandle | null>,
) {
  useEffect(() => {
    if (!onWsEvent) return;
    onWsEvent.current = (event) => {
      const ref = leaderRef.current;
      if (!ref) return;
      switch (event.kind) {
        case "thinking_start":
          ref.onThinkingStart();
          break;
        case "thinking_delta":
          ref.onThinkingDelta(event.text || "");
          break;
        case "text_delta":
          ref.onTextDelta(event.text || "");
          break;
        case "tool_start":
          ref.onToolStart(event.toolName || "tool");
          break;
        case "tool_end":
          ref.onToolEnd(event.toolName || "tool");
          break;
        case "done":
          ref.onDone();
          break;
      }
    };
    return () => {
      onWsEvent.current = null;
    };
  }, [leaderRef, onWsEvent]);
}
