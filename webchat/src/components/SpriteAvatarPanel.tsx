import { useState } from "react";
import type { AgentExpression } from "../types";
import SpriteAvatar from "./SpriteAvatar";

export default function SpriteAvatarPanel({
  spritePackId = "kael",
  expression,
  mode = "dock",
  title,
  subtitle,
  statusText,
  defaultExpanded = true,
}: {
  spritePackId?: string;
  expression: AgentExpression;
  mode?: "dock" | "stage";
  title?: string;
  subtitle?: string;
  statusText?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggleExpanded = () => {
    setExpanded((current) => !current);
  };

  if (mode === "stage") {
    return (
      <div className="sprite-avatar-stage" aria-label={title || "Character stage"}>
        <div className="sprite-avatar-stage-shell">
          <div className="sprite-avatar-stage-orbit sprite-avatar-stage-orbit--outer" aria-hidden="true" />
          <div className="sprite-avatar-stage-orbit sprite-avatar-stage-orbit--inner" aria-hidden="true" />
          <div className="sprite-avatar-stage-core">
            <SpriteAvatar spritePackId={spritePackId} expression={expression} size="lg" onToggle={toggleExpanded} />
          </div>
        </div>
        {(title || subtitle || statusText) && (
          <div className="sprite-avatar-stage-copy">
            {title && <strong>{title}</strong>}
            {subtitle && <span>{subtitle}</span>}
            {statusText && <em>{statusText}</em>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`sprite-avatar-panel${expanded ? " is-expanded" : ""}`}>
      {expanded ? (
        <div className="sprite-avatar-expanded">
          <SpriteAvatar spritePackId={spritePackId} expression={expression} size="lg" onToggle={toggleExpanded} />
        </div>
      ) : (
        <div className="sprite-avatar-slot">
          <SpriteAvatar spritePackId={spritePackId} expression={expression} size="sm" onToggle={toggleExpanded} />
        </div>
      )}
    </div>
  );
}
