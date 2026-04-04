import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import "./styles/channel-views.css";
import { initPostHog } from "./lib/posthog";

declare global {
  interface Window {
    __GATEWAY_URL__?: string;
    __AUTH_TOKEN__?: string;
    __USER_NAME__?: string;
    __OPENCLAW_TOKEN__?: string;
    __OPENCLAW_GATEWAY_TOKEN__?: string;
    __OPENCLAW_WS_PORT__?: number;
    __OPENCLAW_VNC_URL__?: string;
    __OPENCLAW_SESSION_KEY__?: string;
    __POSTHOG_KEY__?: string;
    __POSTHOG_HOST__?: string;
    __MAPBOX_TOKEN__?: string;
  }
}

initPostHog();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
