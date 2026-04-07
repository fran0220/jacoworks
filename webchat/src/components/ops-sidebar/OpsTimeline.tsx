import { type TranslatedActivity } from "../../lib/feed-translate";

interface OpsTimelineProps {
  activities: TranslatedActivity[];
}

export default function OpsTimeline({ activities }: OpsTimelineProps) {
  return (
    <div className="ops-section-stack">
      <h3 className="ops-section-title">动态</h3>
      <div className="ops-timeline-list">
        {activities.map((activity) => (
          <div key={activity.id} className="ops-timeline-item">
            <div className="ops-timeline-copy">
              <div className="ops-timeline-meta">
                <span className="ops-timeline-agent">{activity.agentName}</span>
                <span>{activity.relativeTime}</span>
              </div>
              <p>
                <strong>{activity.verb} </strong>
                {activity.objectName}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
