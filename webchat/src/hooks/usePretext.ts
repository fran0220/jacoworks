import { useEffect, useState } from "react";
import { prepare, layout, prepareWithSegments, walkLineRanges, type PreparedText } from "@chenglou/pretext";

/* ---- Font readiness ---- */

interface PretextFont {
  font: string;
  lineHeight: number;
  ready: boolean;
}

/**
 * Wait for document fonts to load, then extract the computed font shorthand
 * and lineHeight from a reference element (defaults to document.body).
 */
export function usePretextFont(refEl?: React.RefObject<HTMLElement | null>): PretextFont {
  const [state, setState] = useState<PretextFont>({ font: "", lineHeight: 0, ready: false });

  useEffect(() => {
    let cancelled = false;

    document.fonts.ready.then(() => {
      if (cancelled) return;
      const el = refEl?.current ?? document.body;
      const cs = getComputedStyle(el);
      const font = cs.font || `${cs.fontSize} ${cs.fontFamily}`;
      const lh = parseFloat(cs.lineHeight);
      const lineHeight = Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.5;
      setState({ font, lineHeight, ready: true });
    });

    return () => { cancelled = true; };
  }, [refEl]);

  return state;
}

/* ---- Height calculation ---- */

interface PretextHeight {
  height: number;
  lineCount: number;
}

const prepareCache = new Map<string, PreparedText>();

function getCachedPrepared(text: string, font: string, whiteSpace?: "normal" | "pre-wrap"): PreparedText {
  const key = `${font}|${whiteSpace ?? "normal"}|${text}`;
  let p = prepareCache.get(key);
  if (!p) {
    p = prepare(text, font, whiteSpace ? { whiteSpace } : undefined);
    prepareCache.set(key, p);
    if (prepareCache.size > 2000) {
      const first = prepareCache.keys().next().value;
      if (first !== undefined) prepareCache.delete(first);
    }
  }
  return p;
}

/**
 * Compute text height without DOM reflow.
 * Returns { height: 0, lineCount: 0 } when font is not ready or text is empty.
 */
export function usePretextHeight(
  text: string,
  maxWidth: number,
  fontInfo: PretextFont,
  whiteSpace?: "normal" | "pre-wrap",
): PretextHeight {
  if (!fontInfo.ready || !text || maxWidth <= 0) {
    return { height: 0, lineCount: 0 };
  }
  const prepared = getCachedPrepared(text, fontInfo.font, whiteSpace);
  return layout(prepared, maxWidth, fontInfo.lineHeight);
}

/**
 * Imperative height calculation (for use outside React render).
 */
export function calcTextHeight(
  text: string,
  font: string,
  lineHeight: number,
  maxWidth: number,
  whiteSpace?: "normal" | "pre-wrap",
): PretextHeight {
  if (!text || maxWidth <= 0) return { height: 0, lineCount: 0 };
  const prepared = getCachedPrepared(text, font, whiteSpace);
  return layout(prepared, maxWidth, lineHeight);
}

/* ---- Shrinkwrap (tightest bubble width) ---- */

/**
 * Binary-search for the narrowest width that preserves the same lineCount.
 * Then walk lines to get the actual max line width for pixel-perfect fit.
 */
export function calcShrinkwrapWidth(
  text: string,
  font: string,
  lineHeight: number,
  maxWidth: number,
): number {
  if (!text) return 0;

  const prepared = getCachedPrepared(text, font);
  const initial = layout(prepared, maxWidth, lineHeight);
  if (initial.lineCount <= 1) {
    // Single line: use walkLineRanges to get exact width
    const rich = prepareWithSegments(text, font);
    let w = 0;
    walkLineRanges(rich, maxWidth, (line) => { if (line.width > w) w = line.width; });
    return Math.ceil(w);
  }

  // Binary search for narrowest width that keeps same lineCount
  let lo = 1;
  let hi = Math.ceil(maxWidth);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (layout(prepared, mid, lineHeight).lineCount <= initial.lineCount) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  // Get actual max line width at the tight width
  const rich = prepareWithSegments(text, font);
  let maxLineWidth = 0;
  walkLineRanges(rich, lo, (line) => { if (line.width > maxLineWidth) maxLineWidth = line.width; });
  return Math.ceil(maxLineWidth);
}

export function useShrinkwrap(
  text: string,
  maxWidth: number,
  fontInfo: PretextFont,
): number {
  if (!fontInfo.ready || !text || maxWidth <= 0) return 0;
  return calcShrinkwrapWidth(text, fontInfo.font, fontInfo.lineHeight, maxWidth);
}

/* ---- Cache management ---- */

export function clearPretextCache(): void {
  prepareCache.clear();
}
