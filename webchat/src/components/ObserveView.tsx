import { lazy, Suspense, useState, type MutableRefObject } from "react";
import { Globe2, Orbit } from "lucide-react";
import { MAPBOX_TOKEN } from "../lib/config";

const AgentObservatory = lazy(() => import("./AgentObservatory"));
const DigitalCityPanel = lazy(() => import("./DigitalCityPanel"));

type ObserveTab = "world" | "city";
type ConnState = "disconnected" | "connecting" | "connected";

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

  return (
    <section className="observe-view">
      <header className="observe-view-head">
        <div>
          <p className="thread-panel-eyebrow">Observe</p>
          <strong>观测系统</strong>
        </div>
        <div className="observe-segmented">
          <button className={`observe-segmented-btn${tab === "world" ? " active" : ""}`} onClick={() => setTab("world")}>
            <Orbit size={14} />
            <span>世界</span>
          </button>
          <button className={`observe-segmented-btn${tab === "city" ? " active" : ""}`} onClick={() => setTab("city")}>
            <Globe2 size={14} />
            <span>城市</span>
          </button>
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
