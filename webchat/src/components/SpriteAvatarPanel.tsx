import { useState } from "react";
import type { AgentExpression } from "../types";
import SpriteAvatar from "./SpriteAvatar";

export default function SpriteAvatarPanel({
  spritePackId = "kael",
  expression,
}: {
  spritePackId?: string;
  expression: AgentExpression;
}) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = () => {
    setExpanded((current) => !current);
  };

  return (
    <div className={`sprite-avatar-panel${expanded ? " is-expanded" : ""}`}>
      {expanded && (
        <div className="sprite-avatar-popover">
          <SpriteAvatar spritePackId={spritePackId} expression={expression} size="lg" onToggle={toggleExpanded} />
        </div>
      )}

      <div className={`sprite-avatar-slot${expanded ? " is-hidden" : ""}`}>
        <SpriteAvatar spritePackId={spritePackId} expression={expression} size="sm" onToggle={toggleExpanded} />
      </div>
    </div>
  );
}
