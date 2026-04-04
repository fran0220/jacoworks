import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Home,
  Orbit,
  PenTool,
  Plus,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import UserMenu from "./UserMenu";
import type { Channel } from "../types";

const ICON_MAP: Record<string, LucideIcon> = {
  bot: Bot,
  sparkles: Sparkles,
  "pen-tool": PenTool,
};

function ChannelIcon({ icon, fallback: Fallback, size = 16 }: { icon?: string; fallback: LucideIcon; size?: number }) {
  if (icon && icon in ICON_MAP) {
    const Comp = ICON_MAP[icon];
    return <Comp size={size} />;
  }
  if (icon && !icon.includes("-") && icon.length <= 3) {
    return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{icon}</span>;
  }
  return <Fallback size={size} />;
}

type ExpandedSection = "agents" | "teams" | null;

interface NavRailProps {
  channels: Channel[];
  activeChannelId: string;
  onChannelChange: (channelId: string) => void;
  onCreateAgent: () => void;
  onCreateTeam: () => void;
  compact: boolean;
  connState: "disconnected" | "connecting" | "connected";
  mobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
}

export default function NavRail({
  channels,
  activeChannelId,
  onChannelChange,
  onCreateAgent,
  onCreateTeam,
  compact,
  connState,
  mobileDrawerOpen,
  onCloseMobileDrawer,
}: NavRailProps) {
  const [expanded, setExpanded] = useState<ExpandedSection>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close flyout on click outside
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setExpanded(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const agentChannels = channels.filter((c) => c.kind === "agent");
  const teamChannels = channels.filter((c) => c.kind === "team");

  const toggleSection = (section: ExpandedSection) => {
    setExpanded((prev) => (prev === section ? null : section));
  };

  const selectChannel = (id: string) => {
    onChannelChange(id);
    onCloseMobileDrawer?.();
  };

  // ── Mobile drawer ──
  if (compact) {
    return (
      <>
        {mobileDrawerOpen && <div className="nav-drawer-backdrop" onClick={onCloseMobileDrawer} />}
        <nav className={`nav-drawer${mobileDrawerOpen ? " open" : ""}`}>
          <div className="nav-drawer-head">
            <span className="nav-drawer-brand">JAcoworks</span>
            <button className="nav-drawer-close" onClick={onCloseMobileDrawer}>
              <X size={18} />
            </button>
          </div>

          <div className="nav-rail-v2-sections">
            {/* Dashboard */}
            <button
              className={`nav-rail-v2-item mobile${activeChannelId === "dashboard" ? " active" : ""}`}
              onClick={() => selectChannel("dashboard")}
            >
              <Home size={18} />
              <span>仪表盘</span>
            </button>

            {/* Agents section */}
            <div className="nav-rail-v2-section mobile">
              <button className="nav-rail-v2-section-header" onClick={() => toggleSection("agents")}>
                <Bot size={16} />
                <span>助手</span>
                {expanded === "agents" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {expanded === "agents" && (
                <div className="nav-rail-v2-section-items">
                  {agentChannels.map((ch) => (
                    <button
                      key={ch.id}
                      className={`nav-rail-v2-sub-item${activeChannelId === ch.id ? " active" : ""}`}
                      onClick={() => selectChannel(ch.id)}
                    >
                      <ChannelIcon icon={ch.icon} fallback={Bot} size={15} />
                      <span>{ch.label}</span>
                    </button>
                  ))}
                  <button className="nav-rail-v2-add-btn" onClick={onCreateAgent}>
                    <Plus size={14} />
                    <span>新建助手</span>
                  </button>
                </div>
              )}
            </div>

            {/* Teams section */}
            <div className="nav-rail-v2-section mobile">
              <button className="nav-rail-v2-section-header" onClick={() => toggleSection("teams")}>
                <Users size={16} />
                <span>团队</span>
                {expanded === "teams" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {expanded === "teams" && (
                <div className="nav-rail-v2-section-items">
                  {teamChannels.map((ch) => (
                    <button
                      key={ch.id}
                      className={`nav-rail-v2-sub-item${activeChannelId === ch.id ? " active" : ""}`}
                      onClick={() => selectChannel(ch.id)}
                    >
                      <Users size={15} />
                      <span>{ch.label}</span>
                      {ch.agentCount != null && <span className="nav-rail-v2-badge">{ch.agentCount}</span>}
                    </button>
                  ))}
                  <button className="nav-rail-v2-add-btn" onClick={onCreateTeam}>
                    <Plus size={14} />
                    <span>新建团队</span>
                  </button>
                </div>
              )}
            </div>

            {/* Observe */}
            <button
              className={`nav-rail-v2-item mobile${activeChannelId === "observe" ? " active" : ""}`}
              onClick={() => selectChannel("observe")}
            >
              <Orbit size={18} />
              <span>观测</span>
            </button>
          </div>

          <div className="nav-drawer-bottom">
            <div className={`nav-rail-conn ${connState}`} />
            <UserMenu compact={compact} />
          </div>
        </nav>
      </>
    );
  }

  // ── Desktop rail ──
  return (
    <nav className="nav-rail-v2" ref={navRef}>
      <div className="nav-rail-v2-top">
        <span className="nav-rail-brand">J</span>
      </div>

      <div className="nav-rail-v2-sections">
        {/* Dashboard */}
        <button
          className={`nav-rail-v2-item${activeChannelId === "dashboard" ? " active" : ""}`}
          onClick={() => onChannelChange("dashboard")}
          title="仪表盘"
        >
          <Home size={18} />
        </button>

        {/* Agents section */}
        <div className={`nav-rail-v2-section${expanded === "agents" ? " expanded" : ""}`}>
          <button
            className="nav-rail-v2-section-header"
            onClick={() => toggleSection("agents")}
            title="助手"
          >
            <Bot size={18} />
          </button>
          {expanded === "agents" && (
            <div className="nav-rail-v2-flyout">
              <div className="nav-rail-v2-flyout-title">助手</div>
              {agentChannels.map((ch) => (
                <button
                  key={ch.id}
                  className={`nav-rail-v2-sub-item${activeChannelId === ch.id ? " active" : ""}`}
                  onClick={() => { onChannelChange(ch.id); setExpanded(null); }}
                >
                  <ChannelIcon icon={ch.icon} fallback={Bot} size={14} />
                  <span>{ch.label}</span>
                </button>
              ))}
              <button className="nav-rail-v2-add-btn" onClick={() => { onCreateAgent(); setExpanded(null); }}>
                <Plus size={13} />
                <span>新建助手</span>
              </button>
            </div>
          )}
        </div>

        {/* Teams section */}
        <div className={`nav-rail-v2-section${expanded === "teams" ? " expanded" : ""}`}>
          <button
            className="nav-rail-v2-section-header"
            onClick={() => toggleSection("teams")}
            title="团队"
          >
            <Users size={18} />
          </button>
          {expanded === "teams" && (
            <div className="nav-rail-v2-flyout">
              <div className="nav-rail-v2-flyout-title">团队</div>
              {teamChannels.map((ch) => (
                <button
                  key={ch.id}
                  className={`nav-rail-v2-sub-item${activeChannelId === ch.id ? " active" : ""}`}
                  onClick={() => { onChannelChange(ch.id); setExpanded(null); }}
                >
                  <Users size={14} />
                  <span>{ch.label}</span>
                  {ch.agentCount != null && <span className="nav-rail-v2-badge">{ch.agentCount}</span>}
                </button>
              ))}
              <button className="nav-rail-v2-add-btn" onClick={() => { onCreateTeam(); setExpanded(null); }}>
                <Plus size={13} />
                <span>新建团队</span>
              </button>
            </div>
          )}
        </div>

        {/* Observe */}
        <button
          className={`nav-rail-v2-item${activeChannelId === "observe" ? " active" : ""}`}
          onClick={() => onChannelChange("observe")}
          title="观测"
        >
          <Orbit size={18} />
        </button>
      </div>

      <div className="nav-rail-v2-bottom">
        <div className={`nav-rail-conn ${connState}`} />
        <div className="nav-rail-user-slot">
          <UserMenu compact={compact} />
        </div>
      </div>
    </nav>
  );
}
