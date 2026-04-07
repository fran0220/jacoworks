import { Bot, Code2, PenTool, Search, Sparkles } from "lucide-react";

const PROFILE_ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  code: Code2,
  search: Search,
  "pen-tool": PenTool,
  sparkles: Sparkles,
};

export function ProfileIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const Icon = PROFILE_ICONS[icon] || Bot;
  return <Icon size={size} />;
}

export function TypeBadge({ type }: { type: "agent" | "team" }) {
  return (
    <span className={`team-type-badge team-type-badge--${type}`}>
      {type === "agent" ? "agent" : "team"}
    </span>
  );
}
