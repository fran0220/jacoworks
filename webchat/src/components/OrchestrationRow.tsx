const ACTION_FALLBACKS: Record<string, string> = {
  assign: "分配了新的协作任务",
  review: "发起了审查流程",
  complete: "确认任务已完成",
  rework: "安排了返工处理",
  patrol_alert: "发出了巡查提醒",
};

export default function OrchestrationRow({
  action,
  detail,
}: {
  action?: string;
  detail?: string;
}) {
  const normalizedAction = action?.trim().toLowerCase() || "";
  const text = detail?.trim() || ACTION_FALLBACKS[normalizedAction] || "协作编排已更新";
  const actionClass = normalizedAction ? ` orchestration-row--${normalizedAction}` : "";

  return (
    <div className={`orchestration-row${actionClass}`}>
      <span className="orchestration-line" />
      <span className="orchestration-text">{text}</span>
      <span className="orchestration-line" />
    </div>
  );
}
