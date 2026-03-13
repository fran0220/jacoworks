import { ArrowDownCircle, Bug, CheckCircle2, ChevronDown, ListTodo, LoaderCircle, LogOut, PanelLeft, Settings, UserCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import type { UpdatePhase } from "../hooks/use-updater";
import { useClickOutside } from "../hooks/use-click-outside";
import { getUser, logout } from "../lib/auth";

export default function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  taskPanelOpen,
  onToggleTaskPanel,
  debugEnabled,
  showRpcLog,
  onToggleRpcLog,
  updatePhase,
  updateVersion,
  onInstallUpdate,
}: {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  taskPanelOpen: boolean;
  onToggleTaskPanel: () => void;
  debugEnabled: boolean;
  showRpcLog: boolean;
  onToggleRpcLog: () => void;
  updatePhase: UpdatePhase;
  updateVersion: string | null;
  onInstallUpdate: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = getUser();

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

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
        {updatePhase === "available" && (
          <button
            type="button"
            className="btn-update"
            title={`新版本 ${updateVersion} 可用`}
            onClick={onInstallUpdate}
          >
            <ArrowDownCircle size={14} />
            <span className="btn-update-label">{updateVersion}</span>
          </button>
        )}
        {updatePhase === "downloading" && (
          <span className="btn-update btn-update--downloading" title="正在下载更新">
            <LoaderCircle size={14} className="spinning" />
            <span className="btn-update-label">更新中</span>
          </span>
        )}
        {updatePhase === "done" && (
          <span className="btn-update btn-update--done" title="更新完成，请重启应用">
            <CheckCircle2 size={14} />
            <span className="btn-update-label">重启生效</span>
          </span>
        )}
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
          className={`btn-cowork${taskPanelOpen ? " active" : ""}`}
          title="任务面板"
          onClick={onToggleTaskPanel}
        >
          <ListTodo size={14} />
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
