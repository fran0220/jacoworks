import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";
import "./react/styles.css";
import "./react/styles/preview.css";
import "./react/styles/visual.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
