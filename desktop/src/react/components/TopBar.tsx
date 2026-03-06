import { AlertCircle, Bug, ChevronDown, Cloud, LoaderCircle, LogOut, PanelLeft, Settings, Unplug, UserCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import type { OcConnectionPhase } from "../hooks/use-cowork-connection";
import { useClickOutside } from "../hooks/use-click-outside";
import { getUser, logout } from "../lib/auth";

function phaseLabel(phase: OcConnectionPhase): string {
  switch (phase) {
    case "idle": return "未连接";
    case "checking": return "检查容器";
    case "provisioning": return "分配容器";
    case "connecting": return "连接中";
    case "ready": return "已连接";
    case "reconnecting": return "重连中";
    case "error": return "连接失败";
  }
}

function phaseColor(phase: OcConnectionPhase): string {
  switch (phase) {
    case "idle": return "idle";
    case "checking":
    case "provisioning":
    case "connecting":
    case "reconnecting": return "busy";
    case "ready": return "ready";
    case "error": return "error";
  }
}

export default function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  ocPhase,
  coworkOpen,
  onToggleCloud,
  debugEnabled,
  showRpcLog,
  onToggleRpcLog,
}: {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  ocPhase: OcConnectionPhase;
  coworkOpen: boolean;
  onToggleCloud: () => void;
  debugEnabled: boolean;
  showRpcLog: boolean;
  onToggleRpcLog: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = getUser();

  const isBusy = ocPhase === "checking" || ocPhase === "provisioning" || ocPhase === "connecting" || ocPhase === "reconnecting";
  const isConnected = ocPhase === "ready";

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  let icon: React.ReactNode;
  if (isBusy) icon = <LoaderCircle size={14} className="spinning" />;
  else if (ocPhase === "error") icon = <AlertCircle size={14} />;
  else if (isConnected) icon = <Unplug size={14} />;
  else icon = <Cloud size={14} />;

  const btnClass = [
    "btn-cowork",
    coworkOpen && "active",
    `phase-${phaseColor(ocPhase)}`,
  ].filter(Boolean).join(" ");

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
        {debugEnabled && (
          <button
            type="button"
            className={`btn-debug${showRpcLog ? " active" : ""}`}
            title="RPC 调试日志"
            onClick={onToggleRpcLog}
          >
            <Bug size={14} />
          </button>
        )}
        <button
          type="button"
          className={btnClass}
          title={isConnected ? "断开云端" : "连接云端"}
          onClick={onToggleCloud}
          disabled={isBusy}
        >
          {icon}
          <span className="btn-cowork-label">{isConnected ? "断开云端" : "云端模式"}</span>
          <span className={`oc-phase-badge ${phaseColor(ocPhase)}`}>
            <span className={`oc-phase-dot ${phaseColor(ocPhase)}`} />
            {phaseLabel(ocPhase)}
          </span>
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
