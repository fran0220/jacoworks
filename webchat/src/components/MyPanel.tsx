import { LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { USER_NAME } from "../lib/config";
import { getRuntimePlatform } from "../lib/platform";
import DesktopPanel from "./DesktopPanel";

function getRuntimeLabel(platform: ReturnType<typeof getRuntimePlatform>): string {
  if (platform === "ios") return "iOS App";
  if (platform === "android") return "Android App";
  return "浏览器";
}

export default function MyPanel() {
  const platform = getRuntimePlatform();

  return (
    <div className="panel-container me-panel">
      <div className="panel-header">
        <Smartphone size={16} />
        <h3>我的</h3>
      </div>

      <div className="me-panel-stack">
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

        <DesktopPanel />

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
    </div>
  );
}
