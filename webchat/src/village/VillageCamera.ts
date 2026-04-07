import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

export const MAP_W = 5500;
export const MAP_H = 3500;
export const MAP_RATIO = MAP_W / MAP_H;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3.0;

const ZOOM_STEP = 0.12;
const PAN_DURATION = 400;

export interface VillageCameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface UseVillageCameraResult {
  camera: VillageCameraState;
  handlers: {
    onWheel: (e: WheelEvent) => void;
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: (e: PointerEvent) => void;
  };
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  panTo: (xPercent: number, yPercent: number) => void;
  viewportToMap: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

export function clampCamera(
  cam: VillageCameraState,
  viewW: number,
  viewH: number,
): VillageCameraState {
  const scaledW = MAP_W * cam.zoom;
  const scaledH = MAP_H * cam.zoom;

  const maxX = Math.max(0, (scaledW - viewW) / 2);
  const maxY = Math.max(0, (scaledH - viewH) / 2);

  return {
    x: Math.max(-maxX, Math.min(maxX, cam.x)),
    y: Math.max(-maxY, Math.min(maxY, cam.y)),
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom)),
  };
}

function fitZoom(viewW: number, viewH: number): number {
  const zoomW = viewW / MAP_W;
  const zoomH = viewH / MAP_H;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zoomW, zoomH)));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function getMapStyle(camera: VillageCameraState): CSSProperties {
  return {
    width: MAP_W,
    height: MAP_H,
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
    transformOrigin: "center center",
  };
}

export function useVillageCamera(
  containerRef: RefObject<HTMLElement | null>,
): UseVillageCameraResult {
  const [camera, setCamera] = useState<VillageCameraState>({ x: 0, y: 0, zoom: 1 });

  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
  const animRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const getContainerSize = useCallback((): { w: number; h: number } | null => {
    const el = containerRef.current;
    if (!el) return null;
    const { width, height } = el.getBoundingClientRect();
    if (width === 0 || height === 0) return null;
    return { w: width, h: height };
  }, [containerRef]);

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const resetView = useCallback(() => {
    cancelAnim();
    const size = getContainerSize();
    if (!size) return;
    const zoom = fitZoom(size.w, size.h);
    setCamera({ x: 0, y: 0, zoom });
  }, [cancelAnim, getContainerSize]);

  // Auto-fit on mount
  useEffect(() => {
    if (mountedRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && !mountedRef.current) {
        mountedRef.current = true;
        const zoom = fitZoom(width, height);
        setCamera({ x: 0, y: 0, zoom });
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const applyZoom = useCallback(
    (newZoom: number, pivotX?: number, pivotY?: number) => {
      cancelAnim();
      setCamera((prev) => {
        const size = getContainerSize();
        if (!size) return prev;

        const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        if (clamped === prev.zoom) return prev;

        // Pivot defaults to viewport center
        const px = pivotX ?? size.w / 2;
        const py = pivotY ?? size.h / 2;

        // Point under cursor in map space before zoom:
        // viewportCenter = (size.w/2, size.h/2)
        // offset from viewport center to pivot = (px - size.w/2, py - size.h/2)
        // that offset in map space (accounting for current pan) = (px - size.w/2 - prev.x) / prev.zoom
        const dx = (px - size.w / 2 - prev.x) / prev.zoom;
        const dy = (py - size.h / 2 - prev.y) / prev.zoom;

        const nx = px - size.w / 2 - dx * clamped;
        const ny = py - size.h / 2 - dy * clamped;

        return clampCamera({ x: nx, y: ny, zoom: clamped }, size.w, size.h);
      });
    },
    [cancelAnim, getContainerSize],
  );

  const zoomIn = useCallback(() => {
    setCamera((prev) => {
      const size = getContainerSize();
      if (!size) return prev;
      return clampCamera({ ...prev, zoom: Math.min(MAX_ZOOM, prev.zoom + ZOOM_STEP) }, size.w, size.h);
    });
  }, [getContainerSize]);

  const zoomOut = useCallback(() => {
    setCamera((prev) => {
      const size = getContainerSize();
      if (!size) return prev;
      return clampCamera({ ...prev, zoom: Math.max(MIN_ZOOM, prev.zoom - ZOOM_STEP) }, size.w, size.h);
    });
  }, [getContainerSize]);

  const panTo = useCallback(
    (xPercent: number, yPercent: number) => {
      cancelAnim();
      const size = getContainerSize();
      if (!size) return;

      const targetX = -((xPercent / 100 - 0.5) * MAP_W * camera.zoom);
      const targetY = -((yPercent / 100 - 0.5) * MAP_H * camera.zoom);
      const target = clampCamera({ x: targetX, y: targetY, zoom: camera.zoom }, size.w, size.h);

      const startX = camera.x;
      const startY = camera.y;
      const startTime = performance.now();

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / PAN_DURATION);
        const e = easeOut(t);
        const x = startX + (target.x - startX) * e;
        const y = startY + (target.y - startY) * e;
        setCamera({ x, y, zoom: target.zoom });
        if (t < 1) {
          animRef.current = requestAnimationFrame(step);
        } else {
          animRef.current = null;
        }
      };
      animRef.current = requestAnimationFrame(step);
    },
    [cancelAnim, getContainerSize, camera.x, camera.y, camera.zoom],
  );

  const viewportToMap = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const vx = clientX - rect.left;
      const vy = clientY - rect.top;

      const mapX = (vx - rect.width / 2 - camera.x) / camera.zoom + MAP_W / 2;
      const mapY = (vy - rect.height / 2 - camera.y) / camera.zoom + MAP_H / 2;

      const xPct = (mapX / MAP_W) * 100;
      const yPct = (mapY / MAP_H) * 100;

      if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return null;
      return { x: xPct, y: yPct };
    },
    [containerRef, camera.x, camera.y, camera.zoom],
  );

  // --- Event handlers ---

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pivotX = e.clientX - rect.left;
      const pivotY = e.clientY - rect.top;

      const delta = -e.deltaY * (e.deltaMode === 1 ? 3 : 1);
      const factor = delta > 0 ? ZOOM_STEP : -ZOOM_STEP;
      applyZoom(camera.zoom + factor, pivotX, pivotY);
    },
    [applyZoom, camera.zoom, containerRef],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      cancelAnim();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        camX: camera.x,
        camY: camera.y,
      };
    },
    [cancelAnim, camera.x, camera.y],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const size = getContainerSize();
      if (!size) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setCamera((prev) =>
        clampCamera({ x: drag.camX + dx, y: drag.camY + dy, zoom: prev.zoom }, size.w, size.h),
      );
    },
    [getContainerSize],
  );

  const onPointerUp = useCallback((_e: PointerEvent) => {
    dragRef.current = null;
  }, []);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  return {
    camera,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp },
    zoomIn,
    zoomOut,
    resetView,
    panTo,
    viewportToMap,
  };
}
