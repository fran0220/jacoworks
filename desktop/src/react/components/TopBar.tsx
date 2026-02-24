import { LogOut, UserCircle2 } from "lucide-react";
import { getUser, logout } from "../lib/auth";

export default function TopBar({ title }: { title: string }) {
  const user = getUser();

  return (
    <header className="topbar">
      <div className="left">
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
