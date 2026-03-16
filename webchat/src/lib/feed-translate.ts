import type { FeedLog, RecentAction } from "./feed";

export interface TranslatedActivity {
  id: string;
  icon: string;
  verb: string;
  colorClass: string;
  agentName: string;
  agentRole: string;
  agentId: string;
  objectName: string | null;
  details: Record<string, string>;
  rawMethod: string;
  rawPath: string;
  rawBody: string | null;
  responseStatus: number | null;
  timestamp: string | null;
  relativeTime: string;
}

interface RouteRule {
  pattern: RegExp;
  icon: string;
  verb: string;
  colorClass: string;
  extractFields?: string[];
}

const ROUTE_RULES: RouteRule[] = [
  { pattern: /POST \/api\/agents\/register/, icon: "UserPlus", verb: "注册了新 Agent", colorClass: "feed-tone-emerald", extractFields: ["name", "role"] },
  { pattern: /POST \/api\/tasks$/, icon: "ListPlus", verb: "创建了新任务", colorClass: "feed-tone-blue", extractFields: ["name"] },
  { pattern: /POST \/api\/tasks\/.*\/modules/, icon: "FolderPlus", verb: "创建了模块", colorClass: "feed-tone-indigo", extractFields: ["name"] },
  { pattern: /POST \/api\/sub-tasks$/, icon: "FilePlus", verb: "创建了子任务", colorClass: "feed-tone-violet", extractFields: ["name"] },
  { pattern: /POST \/api\/sub-tasks\/.*\/claim/, icon: "Hand", verb: "认领了子任务", colorClass: "feed-tone-amber" },
  { pattern: /POST \/api\/sub-tasks\/.*\/start/, icon: "Play", verb: "开始执行子任务", colorClass: "feed-tone-orange" },
  { pattern: /POST \/api\/sub-tasks\/.*\/submit/, icon: "PackageCheck", verb: "提交了子任务", colorClass: "feed-tone-green" },
  { pattern: /POST \/api\/sub-tasks\/.*\/complete/, icon: "CheckCircle2", verb: "通过了审查", colorClass: "feed-tone-emerald" },
  { pattern: /POST \/api\/sub-tasks\/.*\/rework/, icon: "RotateCcw", verb: "驳回了子任务", colorClass: "feed-tone-rose" },
  { pattern: /PUT \/api\/sub-tasks\//, icon: "Pencil", verb: "更新了子任务", colorClass: "feed-tone-slate" },
  { pattern: /POST \/api\/review-records/, icon: "FileSearch", verb: "提交了审查", colorClass: "feed-tone-purple", extractFields: ["score", "comment", "result"] },
  { pattern: /POST \/api\/logs/, icon: "MessageSquare", verb: "写了活动日志", colorClass: "feed-tone-gray", extractFields: ["action", "summary"] },
  { pattern: /POST \/api\/scores\/adjust/, icon: "Trophy", verb: "调整了积分", colorClass: "feed-tone-yellow", extractFields: ["score_delta", "reason"] },
  { pattern: /GET \/api\/rules/, icon: "BookOpen", verb: "查询了规则指令", colorClass: "feed-tone-sky", extractFields: ["task_id", "sub_task_id"] },
  { pattern: /GET \/api\/tasks$/, icon: "Eye", verb: "查看了任务列表", colorClass: "feed-tone-slate", extractFields: ["status", "type"] },
  { pattern: /GET \/api\/tasks\//, icon: "Eye", verb: "查看了任务详情", colorClass: "feed-tone-slate" },
  { pattern: /GET \/api\/sub-tasks\/available/, icon: "Search", verb: "正在查看可领取的任务", colorClass: "feed-tone-cyan", extractFields: ["status", "priority", "type"] },
  { pattern: /GET \/api\/sub-tasks\/mine/, icon: "ClipboardList", verb: "查看了自己的子任务", colorClass: "feed-tone-slate", extractFields: ["status"] },
  { pattern: /GET \/api\/sub-tasks\/latest/, icon: "FileText", verb: "查看了最新子任务", colorClass: "feed-tone-slate" },
  { pattern: /GET \/api\/sub-tasks/, icon: "ClipboardList", verb: "查看了子任务", colorClass: "feed-tone-slate", extractFields: ["status", "assigned_agent"] },
  { pattern: /GET \/api\/scores\/me/, icon: "Award", verb: "查看了自己的积分", colorClass: "feed-tone-amber" },
  { pattern: /GET \/api\/scores\/leaderboard/, icon: "Medal", verb: "查看了排行榜", colorClass: "feed-tone-yellow" },
  { pattern: /GET \/api\/config\/notification/, icon: "Bell", verb: "查看了通知配置", colorClass: "feed-tone-rose" },
  { pattern: /GET \/api\/logs\/mine/, icon: "ScrollText", verb: "查看了自己的日志", colorClass: "feed-tone-gray", extractFields: ["action"] },
  { pattern: /GET \/api\/logs/, icon: "ScrollText", verb: "查看了活动日志", colorClass: "feed-tone-gray", extractFields: ["action", "agent_id"] },
  { pattern: /GET \/api\/review-records/, icon: "FileSearch", verb: "查看了审查记录", colorClass: "feed-tone-purple", extractFields: ["sub_task_id"] },
];

const ROLE_LABELS: Record<string, string> = {
  planner: "规划师",
  executor: "执行者",
  reviewer: "审查员",
  patrol: "巡查员",
};

let _roleLabelsOverride: Record<string, string> | null = null;

export function setRoleLabels(labels: Record<string, string>): void {
  _roleLabelsOverride = labels;
}

function getRoleLabel(role: string): string {
  if (_roleLabelsOverride?.[role]) return _roleLabelsOverride[role];
  return ROLE_LABELS[role] ?? role;
}

const DETAIL_LABELS: Record<string, string> = {
  comment: "评语",
  result: "结果",
  summary: "摘要",
  score_delta: "分值",
  reason: "原因",
  role: "角色",
  status: "状态",
  priority: "优先级",
  type: "类型",
  task_id: "任务",
  sub_task_id: "子任务",
  agent_id: "Agent",
  assigned_agent: "执行者",
  action: "动作",
};

function parseBody(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getQueryParam(path: string, field: string): string | null {
  const queryIndex = path.indexOf("?");
  if (queryIndex < 0) return null;
  const queryString = path.slice(queryIndex + 1);
  const params = new URLSearchParams(queryString);
  const value = params.get(field);
  return value && value.trim() ? value : null;
}

export function translateFeedLog(log: FeedLog): TranslatedActivity {
  const key = `${log.method.toUpperCase()} ${log.path}`;
  const rule = ROUTE_RULES.find((item) => item.pattern.test(key));
  const body = parseBody(log.request_body);

  const details: Record<string, string> = {};
  let objectName: string | null = null;

  if (rule?.extractFields) {
    for (const field of rule.extractFields) {
      const bodyValue = body[field];
      if (bodyValue !== undefined && bodyValue !== null && String(bodyValue).trim() !== "") {
        details[field] = String(bodyValue);
        continue;
      }

      const queryValue = getQueryParam(log.path, field);
      if (queryValue) {
        details[field] = queryValue;
      }
    }

    if (details.name) {
      objectName = details.name;
      delete details.name;
    }
  }

  if (/POST \/api\/review-records/.test(key) && details.score) {
    objectName = `${details.score} 分`;
    delete details.score;
  }

  if (/POST \/api\/logs/.test(key) && details.action) {
    objectName = details.action;
    delete details.action;
  }

  return {
    id: log.id,
    icon: rule?.icon ?? "Activity",
    verb: rule?.verb ?? `访问了 ${log.path}`,
    colorClass: rule?.colorClass ?? "feed-tone-slate",
    agentName: log.agent_name ?? "未知",
    agentRole: getRoleLabel(log.agent_role ?? ""),
    agentId: log.agent_id ?? "",
    objectName,
    details,
    rawMethod: log.method,
    rawPath: log.path,
    rawBody: log.request_body,
    responseStatus: log.response_status,
    timestamp: log.timestamp,
    relativeTime: formatRelativeTime(log.timestamp),
  };
}

export function getDetailLabel(key: string): string {
  return DETAIL_LABELS[key] ?? key;
}

export function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "";
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 10) return "刚刚";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

export type ActionCategory = "complete" | "execute" | "create" | "query" | "score_up" | "score_down";

export function getActionCategory(action: RecentAction): ActionCategory {
  const key = `${action.method.toUpperCase()} ${action.path}`;

  if (/POST \/api\/scores\/adjust/.test(key) && action.request_body) {
    try {
      const body = JSON.parse(action.request_body) as { score_delta?: number };
      return (body.score_delta ?? 0) >= 0 ? "score_up" : "score_down";
    } catch {
      // fall through
    }
  }

  if (/POST .*\/(submit|complete)/.test(key) || /POST .*\/review-records/.test(key)) return "complete";
  if (/POST .*\/(claim|start|rework|cancel)/.test(key) || /PUT \/api\/sub-tasks/.test(key)) return "execute";
  if (action.method.toUpperCase() === "POST") return "create";
  return "query";
}

export function getActionVerb(action: RecentAction): string {
  const key = `${action.method.toUpperCase()} ${action.path}`;
  const rule = ROUTE_RULES.find((item) => item.pattern.test(key));
  return rule?.verb ?? `${action.method.toUpperCase()} ${action.path.split("/api")[1] ?? action.path}`;
}
