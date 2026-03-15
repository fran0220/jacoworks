import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Award,
  Bell,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Eye,
  FilePlus,
  FileSearch,
  FileText,
  FolderPlus,
  Hand,
  Inbox,
  ListPlus,
  Loader,
  Lock,
  Medal,
  MessageSquare,
  PackageCheck,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Trophy,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { fetchAgentSummary, fetchFeedLogs, fetchFeedStatus, type AgentSummary, type FeedLog } from "../lib/feed";
import {
  formatRelativeTime,
  getActionCategory,
  getActionVerb,
  getDetailLabel,
  translateFeedLog,
  type ActionCategory,
  type TranslatedActivity,
} from "../lib/feed-translate";

const ICON_MAP: Record<string, LucideIcon> = {
  Activity,
  Award,
  Bell,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Eye,
  FilePlus,
  FileSearch,
  FileText,
  FolderPlus,
  Hand,
  ListPlus,
  Medal,
  MessageSquare,
  PackageCheck,
  Pencil,
  Play,
  RotateCcw,
  ScrollText,
  Search,
  Trophy,
  UserPlus,
};

const ROLE_LABELS: Record<string, string> = {
  planner: "规划师",
  executor: "执行者",
  reviewer: "审查员",
  patrol: "巡查员",
};

const ROLE_BADGE_CLASSES: Record<string, string> = {
  planner: "feed-role-badge--planner",
  executor: "feed-role-badge--executor",
  reviewer: "feed-role-badge--reviewer",
  patrol: "feed-role-badge--patrol",
};

const ACTION_DOT_CLASSES: Record<ActionCategory, string> = {
  complete: "feed-action-dot--complete",
  execute: "feed-action-dot--execute",
  create: "feed-action-dot--create",
  query: "feed-action-dot--query",
  score_up: "feed-action-dot--score-up",
  score_down: "feed-action-dot--score-down",
};

const MAX_FEED_ITEMS = 200;
const HIGHLIGHT_MS = 3000;
const FLASH_MS = 2000;

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

export default function FeedPanel() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [activities, setActivities] = useState<TranslatedActivity[]>([]);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [flashingAgentIds, setFlashingAgentIds] = useState<Set<string>>(new Set());

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const activitiesRef = useRef<TranslatedActivity[]>([]);
  const pausedRef = useRef(paused);
  const enabledRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    enabledRef.current = enabled === true;
  }, [enabled]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const loadAgentSummaries = useCallback(async (silent = true) => {
    try {
      const summaries = await fetchAgentSummary();
      setAgentSummaries(summaries);
    } catch {
      if (!silent) throw new Error("agent-summary-failed");
    }
  }, []);

  const loadLogs = useCallback(async (incremental = false, silent = true) => {
    try {
      const after = incremental ? activitiesRef.current[0]?.timestamp ?? undefined : undefined;
      const logs: FeedLog[] = await fetchFeedLogs(after, undefined, 100);
      const translated = logs.map(translateFeedLog);

      if (incremental) {
        if (translated.length === 0) return;

        const incomingIds = new Set(translated.map((item) => item.id));
        const incomingAgentIds = new Set(translated.map((item) => item.agentId).filter(Boolean));

        setNewIds(incomingIds);
        setFlashingAgentIds(incomingAgentIds);

        if (highlightTimerRef.current !== null) {
          window.clearTimeout(highlightTimerRef.current);
        }
        if (flashTimerRef.current !== null) {
          window.clearTimeout(flashTimerRef.current);
        }

        highlightTimerRef.current = window.setTimeout(() => {
          setNewIds(new Set());
        }, HIGHLIGHT_MS);

        flashTimerRef.current = window.setTimeout(() => {
          setFlashingAgentIds(new Set());
        }, FLASH_MS);

        setActivities((prev) => {
          const next = mergeActivities(translated, prev);
          activitiesRef.current = next;
          return next;
        });

        requestAnimationFrame(() => {
          timelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        });
        return;
      }

      const next = translated.slice(0, MAX_FEED_ITEMS);
      activitiesRef.current = next;
      setActivities(next);
    } catch {
      if (!silent) throw new Error("feed-logs-failed");
    }
  }, []);

  const init = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const status = await fetchFeedStatus();
      setEnabled(status.enabled);
      setStatusMessage(status.message ?? "");

      if (status.enabled) {
        await Promise.all([loadLogs(false, false), loadAgentSummaries(false)]);
      }
    } catch {
      setEnabled(false);
      setError("无法获取动态流数据");
    } finally {
      setLoading(false);
    }
  }, [loadAgentSummaries, loadLogs]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current || !enabledRef.current) return;
      void loadLogs(true);
      void loadAgentSummaries();
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadAgentSummaries, loadLogs]);

  const filteredActivities = useMemo(() => {
    if (!selectedAgentId) return activities;
    return activities.filter((item) => item.agentId === selectedAgentId);
  }, [activities, selectedAgentId]);

  const selectedAgentName = useMemo(() => {
    if (!selectedAgentId) return "";
    return agentSummaries.find((agent) => agent.id === selectedAgentId)?.name ?? "";
  }, [agentSummaries, selectedAgentId]);

  const handleRefresh = useCallback(() => {
    void Promise.all([loadLogs(true), loadAgentSummaries(true)]);
  }, [loadAgentSummaries, loadLogs]);

  if (loading) {
    return (
      <div className="panel-container">
        <div className="panel-loading">
          <Loader size={20} className="spin-icon" />
          <span>加载动态中...</span>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="panel-container">
        <div className="panel-header">
          <Activity size={16} />
          <h3>动态</h3>
        </div>
        <div className="panel-empty feed-empty-state">
          <Lock size={24} />
          <span>动态流未启用</span>
          <span>{statusMessage || "动态流暂未开启"}</span>
        </div>
        {error && <div className="panel-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="panel-container feed-panel">
      <div className="panel-header feed-panel-header">
        <Activity size={16} />
        <h3>动态</h3>
        <span className="feed-count">{filteredActivities.length}</span>
        {selectedAgentName && (
          <button className="feed-selected-agent" onClick={() => setSelectedAgentId(null)}>
            {selectedAgentName}
            <X size={12} />
          </button>
        )}
        <button className="feed-pause-btn" onClick={() => setPaused((prev) => !prev)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
          <span>{paused ? "继续" : "暂停"}</span>
        </button>
        <button className="feed-pause-btn" onClick={handleRefresh} title="刷新动态">
          <RefreshCw size={14} />
          <span>刷新</span>
        </button>
      </div>

      <div className="feed-layout">
        <div ref={timelineRef} className="feed-timeline">
          {filteredActivities.length === 0 ? (
            <div className="panel-empty feed-empty-state">
              <Inbox size={22} />
              <span>暂无活动记录</span>
            </div>
          ) : (
            <div className="feed-list">
              {filteredActivities.map((activity) => {
                const Icon = ICON_MAP[activity.icon] || Activity;
                const detailEntries = Object.entries(activity.details);

                return (
                  <article
                    key={activity.id}
                    className={`feed-entry${newIds.has(activity.id) ? " feed-entry--new" : ""}`}
                  >
                    <div className={`feed-entry-icon ${activity.colorClass}`}>
                      <Icon size={14} />
                    </div>
                    <div className="feed-entry-content">
                      <div className="feed-entry-main">
                        <span className="feed-entry-agent">{activity.agentName}</span>
                        <span className="feed-entry-role">{activity.agentRole || "未标注"}</span>
                        <span className="feed-entry-verb">{activity.verb}</span>
                        {activity.objectName && <span className="feed-entry-object">{activity.objectName}</span>}
                      </div>

                      {detailEntries.length > 0 && (
                        <div className="feed-entry-details">
                          {detailEntries.map(([key, value]) => (
                            <span key={key}>
                              {getDetailLabel(key)}: {value}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="feed-entry-meta">
                        <span className="feed-timestamp">{activity.relativeTime || "刚刚"}</span>
                        <span className="feed-path">
                          {activity.rawMethod.toUpperCase()} {activity.rawPath}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="feed-agent-sidebar">
          <div className="feed-agent-sidebar-header">
            <Users size={14} />
            <span>Agents · {agentSummaries.length}</span>
          </div>
          <div className="feed-agent-list">
            {agentSummaries.map((agent) => {
              const active = selectedAgentId === agent.id;
              const roleClass = ROLE_BADGE_CLASSES[agent.role] || "";

              return (
                <button
                  key={agent.id}
                  className={`feed-agent-card${active ? " feed-agent-card--active" : ""}${
                    flashingAgentIds.has(agent.id) ? " feed-agent-card--flash" : ""
                  }`}
                  onClick={() => setSelectedAgentId((prev) => (prev === agent.id ? null : agent.id))}
                >
                  <div className="feed-agent-card-head">
                    <span className={`feed-role-badge ${roleClass}`}>{ROLE_LABELS[agent.role] ?? agent.role}</span>
                    <span className="feed-agent-score">{agent.total_score} pt</span>
                  </div>

                  <div className="feed-agent-name">{agent.name}</div>

                  <div className="feed-agent-stats">
                    <span>{agent.today_request_count} 请求</span>
                    <span>{agent.today_submit_count} 提交</span>
                    <span>{agent.today_review_count} 审查</span>
                  </div>

                  <div className="feed-agent-task">
                    {agent.current_sub_task ? `当前: ${agent.current_sub_task.name}` : "当前: 空闲"}
                  </div>

                  {agent.recent_actions.length > 0 && (
                    <div className="feed-agent-actions">
                      {agent.recent_actions.slice(0, 3).map((action, index) => {
                        const category = getActionCategory(action);
                        return (
                          <div key={`${agent.id}-${index}`} className="feed-agent-action-item">
                            <span className={`feed-action-dot ${ACTION_DOT_CLASSES[category]}`} />
                            <span className="feed-agent-action-verb">{getActionVerb(action)}</span>
                            <span className="feed-agent-action-time">{formatRelativeTime(action.timestamp)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </button>
              );
            })}

            {agentSummaries.length === 0 && (
              <div className="panel-empty feed-agent-empty">
                <Users size={20} />
                <span>暂无 Agent</span>
              </div>
            )}
          </div>
        </aside>
      </div>

      {error && <div className="panel-error feed-panel-error">{error}</div>}
    </div>
  );
}
