import { lazy, Suspense, useMemo, useState, type MutableRefObject } from "react";
import { Globe2, Orbit, Radar, Workflow } from "lucide-react";
import { MAPBOX_TOKEN } from "../lib/config";

const AgentObservatory = lazy(() => import("./AgentObservatory"));
const DigitalCityPanel = lazy(() => import("./DigitalCityPanel"));

type ObserveTab = "world" | "city";
type ConnState = "disconnected" | "connecting" | "connected";

const OBSERVE_MODE_META: Record<
  ObserveTab,
  {
    eyebrow: string;
    title: string;
    description: string;
    Icon: typeof Orbit;
  }
> = {
  world: {
    eyebrow: "World Observatory",
    title: "团队协作世界",
    description: "查看三维团队、活动流与模板编队的实时状态。",
    Icon: Orbit,
  },
  city: {
    eyebrow: "Digital City v2",
    title: "数字之城控制台",
    description: "查看五人展示团队、角色信息流与城市功能区信标。",
    Icon: Globe2,
  },
};

export default function ObserveView({
  observatoryEventRef,
  activeTeamSessionKey,
  onTeamChange,
  onSend,
  onAbort,
  streaming,
  connState,
}: {
  observatoryEventRef: MutableRefObject<((event: { kind: string; text?: string; toolName?: string }) => void) | null>;
  activeTeamSessionKey: string;
  onTeamChange: (sessionKey: string) => void;
  onSend: (text: string) => void | Promise<void>;
  onAbort: () => void;
  streaming: boolean;
  connState: ConnState;
}) {
  const [tab, setTab] = useState<ObserveTab>("world");
  const activeMode = useMemo(() => OBSERVE_MODE_META[tab], [tab]);

  return (
    <section className="observe-view">
      <header className="observe-view-head observe-view-head--command">
        <div className="observe-view-heading">
          <p className="thread-panel-eyebrow">Observe</p>
          <div className="observe-view-heading-main">
            <strong>世界 / 城市观测台</strong>
            <span>{activeMode.description}</span>
          </div>
        </div>
        <div className="observe-view-head-side">
          <div className="observe-mode-meta">
            <activeMode.Icon size={14} />
            <div>
              <strong>{activeMode.title}</strong>
              <span>{activeMode.eyebrow}</span>
            </div>
          </div>
          <div className="observe-mode-notes" aria-hidden="true">
            <span>
              <Radar size={13} />
              <span>实时 HUD</span>
            </span>
            <span>
              <Workflow size={13} />
              <span>角色信息流</span>
            </span>
          </div>
          <div className="observe-segmented" role="tablist" aria-label="观测模式切换">
            <button
              className={`observe-segmented-btn${tab === "world" ? " active" : ""}`}
              onClick={() => setTab("world")}
              role="tab"
              aria-selected={tab === "world"}
            >
              <Orbit size={14} />
              <span>世界</span>
            </button>
            <button
              className={`observe-segmented-btn${tab === "city" ? " active" : ""}`}
              onClick={() => setTab("city")}
              role="tab"
              aria-selected={tab === "city"}
            >
              <Globe2 size={14} />
              <span>城市</span>
            </button>
          </div>
        </div>
      </header>

      <div className="observe-view-body">
        {tab === "world" && (
          <Suspense fallback={<div className="observatory-loading"><span className="spinner" /><span>加载观测世界…</span></div>}>
            <AgentObservatory
              onWsEvent={observatoryEventRef}
              activeTeamSessionKey={activeTeamSessionKey}
              onTeamChange={onTeamChange}
              onSend={onSend}
              onAbort={onAbort}
              streaming={streaming}
              connState={connState}
            />
          </Suspense>
        )}

        {tab === "city" && (
          <Suspense fallback={<div className="digital-city-loading"><span className="spinner" /><span>加载数字之城…</span></div>}>
            {MAPBOX_TOKEN ? (
              <DigitalCityPanel mapboxToken={MAPBOX_TOKEN} />
            ) : (
              <div className="ops-empty-card observe-empty">尚未配置 MAPBOX_TOKEN，暂时无法加载城市视图。</div>
            )}
          </Suspense>
        )}
      </div>
    </section>
  );
}
