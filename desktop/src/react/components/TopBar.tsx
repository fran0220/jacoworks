import { AlertCircle, Bug, CheckCircle, ChevronDown, LoaderCircle, LogOut, PanelLeft, Settings, UserCircle2 } from "lucide-react";
import ClawIcon from "./ClawIcon";
import { useEffect, useRef, useState } from "react";
import type { OcConnectionPhase } from "../hooks/use-openclaw-connection";
import { getUser, logout } from "../lib/auth";

export default function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  ocPhase,
  ocStatusText,
  ocUnreadCount,
  openclawOpen,
  onOpenClawChat,
  onCloseOpenClaw,
  debugEnabled,
  showRpcLog,
  onToggleRpcLog,
}: {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  ocPhase: OcConnectionPhase;
  ocStatusText: string;
  ocUnreadCount: number;
  openclawOpen: boolean;
  onOpenClawChat: () => void;
  onCloseOpenClaw: () => void;
  debugEnabled: boolean;
  showRpcLog: boolean;
  onToggleRpcLog: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReadyFlash, setShowReadyFlash] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<OcConnectionPhase>(ocPhase);
  const user = getUser();

  const isBusy = ocPhase === "checking" || ocPhase === "provisioning" || ocPhase === "connecting" || ocPhase === "reconnecting";
  const isError = ocPhase === "error";
  const isReady = ocPhase === "ready";

  // Flash "已连接" for 2s when transitioning to ready
  useEffect(() => {
    if (ocPhase === "ready" && prevPhaseRef.current !== "ready" && prevPhaseRef.current !== "idle") {
      setShowReadyFlash(true);
      const timer = window.setTimeout(() => setShowReadyFlash(false), 2000);
      prevPhaseRef.current = ocPhase;
      return () => window.clearTimeout(timer);
    }
    prevPhaseRef.current = ocPhase;
  }, [ocPhase]);

  const showExpandedText = isBusy || isError || showReadyFlash;

  let displayText = "";
  if (showReadyFlash) displayText = "已连接";
  else if (isError) displayText = "连接失败";
  else if (isBusy) displayText = ocStatusText;

  // Menu click-outside
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

  // Button icon based on phase
  let icon: React.ReactNode;
  if (isBusy) icon = <LoaderCircle size={14} className="spinning" />;
  else if (isError) icon = <AlertCircle size={14} />;
  else if (showReadyFlash) icon = <CheckCircle size={14} />;
  else icon = <ClawIcon size={14} />;

  const btnClass = [
    "btn-openclaw",
    openclawOpen && "active",
    showExpandedText && "expanded",
    isReady && !showReadyFlash && "has-dot",
    showReadyFlash && "ready-flash",
    isError && "error",
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
          title="OpenClaw"
          onClick={() => {
            if (openclawOpen) {
              onCloseOpenClaw();
            } else {
              onOpenClawChat();
            }
          }}
        >
          {icon}
          {showExpandedText && <span className="oc-status-text">{displayText}</span>}
          {isReady && !showReadyFlash && !openclawOpen && ocUnreadCount > 0 ? (
            <span className="oc-badge">{ocUnreadCount > 99 ? "99+" : ocUnreadCount}</span>
          ) : (
            isReady && !showReadyFlash && <span className="oc-dot" />
          )}
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
