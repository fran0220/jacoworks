export const GATEWAY_URL = (window.__GATEWAY_URL__ || "").replace(/\/$/, "");
export const AUTH_TOKEN = window.__AUTH_TOKEN__ || "";
export const USER_NAME = window.__USER_NAME__ || "";
export function getOpenClawToken(): string {
  return window.__OPENCLAW_TOKEN__ || window.__OPENCLAW_GATEWAY_TOKEN__ || "";
}
export function getOpenClawWsPort(): number {
  return window.__OPENCLAW_WS_PORT__ || 0;
}

export function getOpenClawVncUrl(): string {
  return window.__OPENCLAW_VNC_URL__ || "";
}

export const OPENCLAW_TOKEN = getOpenClawToken();

export const DEFAULT_OPENCLAW_SESSION_KEY = window.__OPENCLAW_SESSION_KEY__ || "agent:default:main";
