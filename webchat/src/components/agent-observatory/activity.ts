import type { FeedLog } from "../../lib/feed";
import type { ActivityItem } from "./types";

export function feedLogToActivity(log: FeedLog): ActivityItem {
  const ts = log.timestamp ? new Date(log.timestamp).getTime() : Date.now();
  let action = `${log.method} ${log.path}`;
  if (log.path.includes("submit")) action = "提交了任务";
  else if (log.path.includes("review")) action = "审核了任务";
  else if (log.path.includes("claim")) action = "领取了任务";
  else if (log.path.includes("score")) action = "得分变更";
  else if (log.path.includes("task")) action = "处理任务";
  return {
    id: log.id,
    agentName: log.agent_name || "未知",
    agentRole: log.agent_role || "agent",
    action,
    timestamp: ts,
  };
}
