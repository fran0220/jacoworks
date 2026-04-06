import { useEffect, useMemo, useReducer } from "react";
import { isCompactViewport } from "../lib/platform";
import type { AppMode, OpsLens, View } from "../types";

interface UIShellState {
  mode: AppMode;
  compact: boolean;
  sidebarOpen: boolean;
  opsPanelOpen: boolean;
  opsLens: OpsLens;
  mobileDrawerOpen: boolean;
  configDrawerOpen: boolean;
}

type UIShellAction =
  | { type: "set_mode"; mode: AppMode }
  | { type: "set_view"; view: View }
  | { type: "set_compact"; compact: boolean }
  | { type: "toggle_sidebar" }
  | { type: "close_sidebar" }
  | { type: "toggle_ops_panel" }
  | { type: "set_ops_lens"; lens: OpsLens }
  | { type: "toggle_mobile_drawer" }
  | { type: "close_mobile_drawer" }
  | { type: "toggle_config_drawer" }
  | { type: "close_config_drawer" };

function createInitialState(): UIShellState {
  return {
    mode: "workspace",
    compact: isCompactViewport(),
    sidebarOpen: false,
    opsPanelOpen: false,
    opsLens: "overview",
    mobileDrawerOpen: false,
    configDrawerOpen: false,
  };
}

function reducer(state: UIShellState, action: UIShellAction): UIShellState {
  switch (action.type) {
    case "set_mode":
      return {
        ...state,
        mode: action.mode,
        sidebarOpen: false,
        opsPanelOpen: false,
        mobileDrawerOpen: false,
        configDrawerOpen: false,
      };
    case "set_view":
      return {
        ...state,
        mode: "workspace",
        sidebarOpen: false,
        opsPanelOpen: false,
        mobileDrawerOpen: false,
        configDrawerOpen: false,
      };
    case "set_compact":
      return {
        ...state,
        compact: action.compact,
        sidebarOpen: action.compact ? state.sidebarOpen : false,
        opsPanelOpen: action.compact ? false : state.opsPanelOpen,
      };
    case "toggle_sidebar":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "close_sidebar":
      return state.sidebarOpen ? { ...state, sidebarOpen: false } : state;
    case "toggle_ops_panel":
      return state.compact ? { ...state, opsPanelOpen: !state.opsPanelOpen } : state;
    case "set_ops_lens":
      return { ...state, opsLens: action.lens };
    case "toggle_mobile_drawer":
      return { ...state, mobileDrawerOpen: !state.mobileDrawerOpen };
    case "close_mobile_drawer":
      return state.mobileDrawerOpen ? { ...state, mobileDrawerOpen: false } : state;
    case "toggle_config_drawer":
      return { ...state, configDrawerOpen: !state.configDrawerOpen };
    case "close_config_drawer":
      return state.configDrawerOpen ? { ...state, configDrawerOpen: false } : state;
    default:
      return state;
  }
}

export type UIShellStateSnapshot = UIShellState;

export interface UseUIShellResult extends UIShellState {
  /** @deprecated Use mode instead */
  view: View;
  /** @deprecated Use setMode instead */
  setView: (view: View) => void;
  setMode: (mode: AppMode) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleOpsPanel: () => void;
  setOpsLens: (lens: OpsLens) => void;
  toggleMobileDrawer: () => void;
  closeMobileDrawer: () => void;
  toggleConfigDrawer: () => void;
  closeConfigDrawer: () => void;
}

export default function useUIShell(): UseUIShellResult {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(max-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => {
      dispatch({ type: "set_compact", compact: event.matches });
    };

    dispatch({ type: "set_compact", compact: media.matches });

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return useMemo(
    () => ({
      ...state,
      view: (state.mode === "workspace" ? "workbench" : "workbench") as View,
      setView: (view: View) => dispatch({ type: "set_view", view }),
      setMode: (mode: AppMode) => dispatch({ type: "set_mode", mode }),
      toggleSidebar: () => dispatch({ type: "toggle_sidebar" }),
      closeSidebar: () => dispatch({ type: "close_sidebar" }),
      toggleOpsPanel: () => dispatch({ type: "toggle_ops_panel" }),
      setOpsLens: (lens: OpsLens) => dispatch({ type: "set_ops_lens", lens }),
      toggleMobileDrawer: () => dispatch({ type: "toggle_mobile_drawer" }),
      closeMobileDrawer: () => dispatch({ type: "close_mobile_drawer" }),
      toggleConfigDrawer: () => dispatch({ type: "toggle_config_drawer" }),
      closeConfigDrawer: () => dispatch({ type: "close_config_drawer" }),
    }),
    [state],
  );
}
