import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";

declare global {
  interface Window {
    __GATEWAY_URL__?: string;
    __AUTH_TOKEN__?: string;
    __USER_NAME__?: string;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
