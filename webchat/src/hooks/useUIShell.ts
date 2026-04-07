import { useEffect, useMemo, useReducer } from "react";
import { isCompactViewport } from "../lib/platform";
import type { View } from "../types";

export type { View };

export interface UIShellState {
  view: View;
  compact: boolean;
  sidebarOpen: boolean;
}

type UIShellAction =
  | { type: "set_view"; view: View }
  | { type: "set_compact"; compact: boolean }
  | { type: "toggle_sidebar" }
  | { type: "close_sidebar" };

function createInitialState(): UIShellState {
  return {
    view: "agent",
    compact: isCompactViewport(),
    sidebarOpen: false,
  };
}

function reducer(state: UIShellState, action: UIShellAction): UIShellState {
  switch (action.type) {
    case "set_view":
      return { ...state, view: action.view, sidebarOpen: false };
    case "set_compact":
      return {
        ...state,
        compact: action.compact,
        sidebarOpen: action.compact ? state.sidebarOpen : false,
      };
    case "toggle_sidebar":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "close_sidebar":
      return state.sidebarOpen ? { ...state, sidebarOpen: false } : state;
    default:
      return state;
  }
}

export interface UseUIShellResult extends UIShellState {
  setView: (view: View) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
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
      setView: (view: View) => dispatch({ type: "set_view", view }),
      toggleSidebar: () => dispatch({ type: "toggle_sidebar" }),
      closeSidebar: () => dispatch({ type: "close_sidebar" }),
    }),
    [state],
  );
}
