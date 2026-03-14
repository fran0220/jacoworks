import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export function useDragDrop(
  containerRef: RefObject<HTMLElement | null>,
  onDrop: (paths: string[]) => void,
  enabled = true,
): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);
  const dragCounterRef = useRef(0);

  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled || !isTauri()) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      if (cancelled) {
        return;
      }

      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === "enter") {
            setIsDragging(true);
          }

          if (event.payload.type === "leave") {
            setIsDragging(false);
          }

          if (event.payload.type === "drop") {
            setIsDragging(false);
            onDropRef.current(event.payload.paths);
          }
        })
        .then((fn) => {
          unlisten = fn;
        });
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) {
      return;
    }

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/x-jaco-file")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/x-jaco-file")) {
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("application/x-jaco-file")) {
        return;
      }

      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      const path = e.dataTransfer?.getData("application/x-jaco-file");
      if (path) {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        onDropRef.current([path]);
      }
    };

    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("dragenter", handleDragEnter);
    el.addEventListener("dragleave", handleDragLeave);
    el.addEventListener("drop", handleDrop);

    return () => {
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("dragenter", handleDragEnter);
      el.removeEventListener("dragleave", handleDragLeave);
      el.removeEventListener("drop", handleDrop);
    };
  }, [containerRef, enabled]);

  return isDragging;
}
