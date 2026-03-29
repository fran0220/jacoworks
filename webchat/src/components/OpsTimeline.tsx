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
  Medal,
  MessageSquare,
  PackageCheck,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Trophy,
  UserPlus,
} from "lucide-react";
import { fetchFeedLogs, fetchFeedStatus } from "../lib/feed";
import { formatRelativeTime, translateFeedLog, type TranslatedActivity } from "../lib/feed-translate";

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
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Trophy,
  UserPlus,
};

function mergeActivities(incoming: TranslatedActivity[], existing: TranslatedActivity[]): TranslatedActivity[] {
  const merged: TranslatedActivity[] = [];
  const seen = new Set<string>();

  for (const item of [...incoming, ...existing]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return merged.slice(0, 24);
}

export default function OpsTimeline({
  activities,
  selectedAgentId,
  onSelectAgent,
  onRefresh,
}: {
  activities?: TranslatedActivity[];
  selectedAgentId?: string | null;
  onSelectAgent?: (id: string | null) => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const controlled = Array.isArray(activities);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState<string | null>(null);
  const [internalActivities, setInternalActivities] = useState<TranslatedActivity[]>([]);
  const activitiesRef = useRef<TranslatedActivity[]>([]);

  const loadActivities = useCallback(
    async (incremental = false) => {
      if (controlled) return;

      if (!incremental) {
        setLoading(true);
      }

      try {
        const status = await fetchFeedStatus();
        setEnabled(status.enabled);
        if (!status.enabled) {
          setInternalActivities([]);
          return;
        }

        const after = incremental ? activitiesRef.current[0]?.timestamp ?? undefined : undefined;
        const logs = await fetchFeedLogs(after, undefined, 24);
        const translated = logs.map(translateFeedLog);
        const next = incremental ? mergeActivities(translated, activitiesRef.current) : translated;
        activitiesRef.current = next;
        setInternalActivities(next);
        setError(null);
      } catch {
        setError("动态流加载失败");
      } finally {
        if (!incremental) {
          setLoading(false);
        }
      }
    },
    [controlled],
  );

  useEffect(() => {
    if (controlled) return;
    void loadActivities(false);
  }, [controlled, loadActivities]);

  useEffect(() => {
    if (controlled) return;
    const timer = window.setInterval(() => {
      void loadActivities(true);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [controlled, loadActivities]);

  const list = controlled ? activities ?? [] : internalActivities;
  const filtered = useMemo(() => {
    if (!selectedAgentId) return list;
    return list.filter((item) => item.agentId === selectedAgentId);
  }, [list, selectedAgentId]);

  return (
    <div className="ops-section-stack">
      <section className="ops-section-card ops-section-card--flush">
        <div className="ops-section-title ops-section-title--spread">
          <span className="ops-title-inline">
            <Activity size={14} />
            <span>最新动态</span>
          </span>
          <button
            className="ops-inline-action"
            onClick={() => {
              void onRefresh?.();
              void loadActivities(false);
            }}
            title="刷新动态"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {loading && (
          <div className="ops-inline-loading">
            <Loader size={15} className="spin-icon" />
            <span>加载动态中…</span>
          </div>
        )}

        {!loading && !enabled && <div className="ops-empty-card">动态流尚未启用</div>}
        {!loading && enabled && filtered.length === 0 && (
          <div className="ops-empty-card">
            <Inbox size={16} />
            <span>最近没有新的协作动态</span>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="ops-timeline-list">
            {filtered.map((activity) => {
              const Icon = ICON_MAP[activity.icon] ?? Activity;
              return (
                <article key={activity.id} className="ops-timeline-item">
                  <div className={`ops-timeline-icon ${activity.colorClass}`}>
                    <Icon size={13} />
                  </div>
                  <div className="ops-timeline-copy">
                    <button
                      className="ops-timeline-agent"
                      onClick={() => onSelectAgent?.(selectedAgentId === activity.agentId ? null : activity.agentId)}
                    >
                      {activity.agentName}
                    </button>
                    <p>
                      <span>{activity.verb}</span>
                      {activity.objectName && <strong>{activity.objectName}</strong>}
                    </p>
                    <div className="ops-timeline-meta">
                      <span>{activity.agentRole}</span>
                      <span>{activity.relativeTime || formatRelativeTime(activity.timestamp)}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {error && <div className="thread-panel-error">{error}</div>}
      </section>
    </div>
  );
}
