import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  fetchAgentSummary,
  fetchCrewTasks,
  fetchFeedLogs,
  type AgentSummary,
  type CrewTask,
  type FeedLog,
} from "../lib/feed";
import { translateFeedLog, type TranslatedActivity } from "../lib/feed-translate";
import type { DashboardStats } from "../lib/ops-types";

const MAX_FEED_ITEMS = 200;

interface OperationsState {
  loading: boolean;
  enabled: boolean;
  statusMessage: string;
  error: string | null;
  paused: boolean;
  agentSummaries: AgentSummary[];
  crewTasks: CrewTask[];
  activities: TranslatedActivity[];
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  dashboardStats: DashboardStats | null;
}

type OperationsAction =
  | { type: "set_loading"; loading: boolean }
  | { type: "set_status"; enabled: boolean; statusMessage: string }
  | { type: "set_error"; error: string | null }
  | { type: "set_paused"; paused: boolean }
  | { type: "set_agents"; agentSummaries: AgentSummary[] }
  | { type: "set_tasks"; crewTasks: CrewTask[] }
  | { type: "set_activities"; activities: TranslatedActivity[] }
  | { type: "set_dashboard"; dashboardStats: DashboardStats | null }
  | { type: "select_agent"; agentId: string | null }
  | { type: "select_task"; taskId: string | null }
  | { type: "reset_filters" };

function createInitialState(): OperationsState {
  return {
    loading: true,
    enabled: false,
    statusMessage: "",
    error: null,
    paused: false,
    agentSummaries: [],
    crewTasks: [],
    activities: [],
    selectedAgentId: null,
    selectedTaskId: null,
    dashboardStats: null,
  };
}

function reducer(state: OperationsState, action: OperationsAction): OperationsState {
  switch (action.type) {
    case "set_loading":
      return { ...state, loading: action.loading };
    case "set_status":
      return { ...state, enabled: action.enabled, statusMessage: action.statusMessage };
    case "set_error":
      return { ...state, error: action.error };
    case "set_paused":
      return { ...state, paused: action.paused };
    case "set_agents":
      return { ...state, agentSummaries: action.agentSummaries };
    case "set_tasks":
      return { ...state, crewTasks: action.crewTasks };
    case "set_activities":
      return { ...state, activities: action.activities };
    case "set_dashboard":
      return { ...state, dashboardStats: action.dashboardStats };
    case "select_agent":
      return { ...state, selectedAgentId: action.agentId };
    case "select_task":
      return { ...state, selectedTaskId: action.taskId };
    case "reset_filters":
      return { ...state, selectedAgentId: null, selectedTaskId: null };
    default:
      return state;
  }
}

function mergeActivities(incoming: TranslatedActivity[], existing: TranslatedActivity[]): TranslatedActivity[] {
  const merged: TranslatedActivity[] = [];
  const seen = new Set<string>();

  for (const item of [...incoming, ...existing]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return merged.slice(0, MAX_FEED_ITEMS);
}

function isCrewMode(agentSummaries: AgentSummary[], crewTasks: CrewTask[]): boolean {
  if (crewTasks.length > 0) return true;
  return agentSummaries.some(
    (agent) =>
      agent.source === "crew" ||
      agent.presence_state !== undefined ||
      (agent.reserved_paths?.length ?? 0) > 0,
  );
}

function isActiveCrewTask(task: CrewTask): boolean {
  return (
    task.status === "assigned" ||
    task.status === "in-progress" ||
    task.status === "running" ||
    task.status === "blocked"
  );
}

function buildDashboardStats(
  agentSummaries: AgentSummary[],
  crewTasks: CrewTask[],
): DashboardStats {
  const topScore = agentSummaries.reduce((max, item) => Math.max(max, item.total_score), 0);

  if (crewTasks.length > 0) {
    return {
      totalTasks: crewTasks.length,
      activeTasks: crewTasks.filter(isActiveCrewTask).length,
      totalAgents: agentSummaries.length,
      topScore,
    };
  }

  const activeTasks = agentSummaries.filter((item) => item.current_sub_task !== null).length;
  return {
    totalTasks: activeTasks,
    activeTasks,
    totalAgents: agentSummaries.length,
    topScore,
  };
}

export interface UseOperationsResult extends OperationsState {
  refresh: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  selectTask: (taskId: string | null) => void;
  setPaused: (paused: boolean) => void;
}

export default function useOperations(_workspaceKey: string): UseOperationsResult {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const activitiesRef = useRef<TranslatedActivity[]>([]);
  const pausedRef = useRef(false);
  const enabledRef = useRef(false);

  useEffect(() => {
    activitiesRef.current = state.activities;
  }, [state.activities]);

  useEffect(() => {
    pausedRef.current = state.paused;
  }, [state.paused]);

  useEffect(() => {
    enabledRef.current = state.enabled;
  }, [state.enabled]);

  const loadAgentSummaries = useCallback(async (silent = true) => {
    try {
      const agentSummaries = await fetchAgentSummary();
      dispatch({ type: "set_agents", agentSummaries });
      return agentSummaries;
    } catch (error) {
      if (!silent) throw error;
      return [];
    }
  }, []);

  const loadCrewTasks = useCallback(async (silent = true) => {
    try {
      const crewTasks = await fetchCrewTasks();
      dispatch({ type: "set_tasks", crewTasks });
      return crewTasks;
    } catch (error) {
      if (!silent) throw error;
      return [];
    }
  }, []);

  const loadActivities = useCallback(async (incremental = false, silent = true) => {
    try {
      const after = incremental ? activitiesRef.current[0]?.timestamp ?? undefined : undefined;
      const feedLogs: FeedLog[] = await fetchFeedLogs(after ?? undefined, undefined, 100);
      const translated = feedLogs.map(translateFeedLog);

      if (incremental) {
        if (translated.length === 0) return activitiesRef.current;
        const merged = mergeActivities(translated, activitiesRef.current);
        dispatch({ type: "set_activities", activities: merged });
        activitiesRef.current = merged;
        return merged;
      }

      const activities = translated.slice(0, MAX_FEED_ITEMS);
      dispatch({ type: "set_activities", activities });
      activitiesRef.current = activities;
      return activities;
    } catch (error) {
      if (!silent) throw error;
      return activitiesRef.current;
    }
  }, []);

  const syncOpsSummary = useCallback((agentSummaries: AgentSummary[], crewTasks: CrewTask[]) => {
    dispatch({ type: "set_dashboard", dashboardStats: buildDashboardStats(agentSummaries, crewTasks) });
    dispatch({
      type: "set_status",
      enabled: true,
      statusMessage: isCrewMode(agentSummaries, crewTasks) ? "Crew 实况" : "VM 运营数据",
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      dispatch({ type: "set_error", error: null });
      const [, agentSummaries, crewTasks] = await Promise.all([
        loadActivities(true, false),
        loadAgentSummaries(false),
        loadCrewTasks(false),
      ]);
      syncOpsSummary(agentSummaries, crewTasks);
    } catch {
      dispatch({ type: "set_error", error: "无法刷新运营数据" });
    }
  }, [loadActivities, loadAgentSummaries, loadCrewTasks, syncOpsSummary]);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "set_loading", loading: true });
    dispatch({ type: "reset_filters" });
    dispatch({ type: "set_status", enabled: true, statusMessage: "加载运营数据…" });
    dispatch({ type: "set_error", error: null });

    void Promise.all([
      loadActivities(false, false),
      loadAgentSummaries(false),
      loadCrewTasks(false),
    ])
      .then(([, agentSummaries, crewTasks]) => {
        if (cancelled) return;
        syncOpsSummary(agentSummaries, crewTasks);
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "set_error", error: "无法获取运营数据" });
      })
      .finally(() => {
        if (cancelled) return;
        dispatch({ type: "set_loading", loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [_workspaceKey, loadActivities, loadAgentSummaries, loadCrewTasks, syncOpsSummary]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current || !enabledRef.current) return;
      void loadActivities(true);
      void Promise.all([loadAgentSummaries(), loadCrewTasks()]).then(
        ([agentSummaries, crewTasks]) => {
          syncOpsSummary(agentSummaries, crewTasks);
        },
      );
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadActivities, loadAgentSummaries, loadCrewTasks, syncOpsSummary]);

  return useMemo(
    () => ({
      ...state,
      refresh,
      selectAgent: (agentId: string | null) => dispatch({ type: "select_agent", agentId }),
      selectTask: (taskId: string | null) => dispatch({ type: "select_task", taskId }),
      setPaused: (paused: boolean) => dispatch({ type: "set_paused", paused }),
    }),
    [refresh, state],
  );
}
