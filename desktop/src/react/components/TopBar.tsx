import { ChevronDown, Cloud, LogOut, PanelLeft, Settings, UserCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getUser, logout } from "../lib/auth";

export default function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onToggleOpenClaw,
}: {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onToggleOpenClaw: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = getUser();

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="left">
        <button
          type="button"
          className="btn-sidebar"
          aria-label={sidebarOpen ? "收起会话列表" : "展开会话列表"}
          aria-expanded={sidebarOpen}
          aria-controls="chat-sidebar"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={14} />
        </button>
        <h2 className="title">{title}</h2>
      </div>
      <div className="right">
        <button type="button" className="btn-openclaw" onClick={onToggleOpenClaw}>
          <Cloud size={14} />
          <span>OpenClaw</span>
        </button>
        <div className="user-menu-wrapper" ref={menuRef}>
          <button
            className="user-menu-trigger"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <UserCircle2 size={14} />
            <span className="user-menu-name">{user?.name || user?.email}</span>
            <ChevronDown size={12} className={`user-menu-chevron ${menuOpen ? "open" : ""}`} />
          </button>

          {menuOpen && (
            <div className="user-menu">
              <button
                className="user-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
              >
                <Settings size={14} />
                设置
              </button>
              <div className="user-menu-divider" />
              <button
                className="user-menu-item danger"
                onClick={() => logout()}
              >
                <LogOut size={14} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
