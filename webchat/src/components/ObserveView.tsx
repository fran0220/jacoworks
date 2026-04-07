import { useState } from "react";
import { MAPBOX_TOKEN } from "../lib/config";
import AgentObservatory from "./AgentObservatory";
import DigitalCityPanel from "./DigitalCityPanel";

interface ObserveViewProps {
  observatoryEventRef: React.MutableRefObject<any>;
  activeTeamSessionKey: string;
  onTeamChange: (key: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  connState: "disconnected" | "connecting" | "connected";
}

export default function ObserveView(props: ObserveViewProps) {
  const [mode, setMode] = useState<"observatory" | "city">("observatory");

  return (
    <div className="observe-view">
      <div className="observe-header">
        <div className="observe-tabs">
          <button
            className={`observe-tab${mode === "observatory" ? " active" : ""}`}
            onClick={() => setMode("observatory")}
          >
            观测站
          </button>
          <button
            className={`observe-tab${mode === "city" ? " active" : ""}`}
            onClick={() => setMode("city")}
          >
            数字城市
          </button>
        </div>
      </div>

      <div className="observe-content">
        {mode === "observatory" ? (
          <AgentObservatory
            onWsEvent={props.observatoryEventRef}
            activeTeamSessionKey={props.activeTeamSessionKey}
            onTeamChange={props.onTeamChange}
            onSend={props.onSend}
            onAbort={props.onAbort}
            streaming={props.streaming}
            connState={props.connState}
          />
        ) : (
          <DigitalCityPanel mapboxToken={MAPBOX_TOKEN} />
        )}
      </div>
    </div>
  );
}
