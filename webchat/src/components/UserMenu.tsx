import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { USER_NAME } from "../lib/config";
import { getRuntimePlatform } from "../lib/platform";
import DesktopPanel from "./DesktopPanel";

function getRuntimeLabel(platform: ReturnType<typeof getRuntimePlatform>): string {
  if (platform === "ios") return "iOS App";
  if (platform === "android") return "Android App";
  return "浏览器";
}

export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initial = useMemo(() => (USER_NAME || "U").charAt(0).toUpperCase(), []);
  const platform = getRuntimePlatform();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`user-menu${open ? " open" : ""}${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="user-menu-trigger"
        title={USER_NAME || "用户菜单"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="nav-rail-avatar">{initial}</span>
        {!compact && <ChevronDown size={14} className="user-menu-caret" />}
      </button>

      {open && (
        <div className="user-menu-popover" role="menu">
          <section className="my-panel-card">
            <div className="my-panel-card-head">
              <div>
                <strong>{USER_NAME || "当前用户"}</strong>
                <p>当前运行环境：{getRuntimeLabel(platform)}</p>
              </div>
              <span className="my-panel-badge">
                <ShieldCheck size={14} />
                云端协作
              </span>
            </div>
          </section>

          <section className="my-panel-card user-menu-runtime-card">
            <div className="my-panel-card-head">
              <div>
                <strong>客户端入口</strong>
                <p>桌面与浏览器入口已收纳到头像菜单，方便在任何视图里快速访问。</p>
              </div>
              <Smartphone size={18} />
            </div>
          </section>

          <div className="user-menu-desktop-panel">
            <DesktopPanel />
          </div>

          <section className="my-panel-card">
            <div className="my-panel-card-head">
              <div>
                <strong>账号</strong>
                <p>退出后会返回 `/login`，下次进入 App 需要重新完成网页登录。</p>
              </div>
              <LogOut size={18} />
            </div>
            <form method="post" action="/logout" className="my-panel-actions">
              <button type="submit" className="my-panel-secondary">
                <LogOut size={16} />
                退出登录
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
