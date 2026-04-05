export const GATEWAY_URL = (window.__GATEWAY_URL__ || "").replace(/\/$/, "");
export const AUTH_TOKEN = window.__AUTH_TOKEN__ || "";
export const USER_NAME = window.__USER_NAME__ || "";
export function getPiVMToken(): string {
  return window.__PI_TOKEN__ || window.__PIVM_TOKEN__ || "";
}
export function getPiVMWsPort(): number {
  return window.__PI_WS_PORT__ || 0;
}

export function getPiVMVncUrl(): string {
  return window.__PI_VNC_URL__ || "";
}

export const PIVM_TOKEN = getPiVMToken();

export const DEFAULT_SESSION_KEY = window.__PI_SESSION_KEY__ || "agent:default";

export const MAPBOX_TOKEN: string = window.__MAPBOX_TOKEN__ || "";
