import { LogOut, PanelLeft, UserCircle2 } from "lucide-react";
import { getUser, logout } from "../lib/auth";

export default function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const user = getUser();

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
        <span className="username">
          <UserCircle2 size={14} />
          {user?.name || user?.email}
        </span>
        <button className="btn-logout" onClick={() => logout()}>
          <LogOut size={14} />
          退出
        </button>
      </div>
    </header>
  );
}
