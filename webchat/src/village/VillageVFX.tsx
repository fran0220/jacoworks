import type { CSSProperties } from "react";

const EMBERS: { dx: number; dy: number; size: number; delay: number; color: string }[] = [
  { dx: 0, dy: 0, size: 4, delay: 0, color: "#ffb347" },
  { dx: 3, dy: -2, size: 3, delay: 0.18, color: "#ffd580" },
  { dx: -4, dy: 1, size: 5, delay: 0.4, color: "#ff9f1c" },
  { dx: 6, dy: -1, size: 3, delay: 0.65, color: "#ffe0a0" },
  { dx: -2, dy: -3, size: 6, delay: 0.85, color: "#ffb347" },
  { dx: 1, dy: 2, size: 4, delay: 1.05, color: "#ffd580" },
  { dx: -5, dy: 0, size: 3, delay: 1.25, color: "#ff9f1c" },
  { dx: 4, dy: -2, size: 5, delay: 0.3, color: "#ffe0a0" },
  { dx: -1, dy: 1, size: 4, delay: 0.55, color: "#ffb347" },
  { dx: 2, dy: -1, size: 3, delay: 0.95, color: "#ffd580" },
];

const SHIMMER_BARS: { x: number; y: number; w: number; delay: number }[] = [
  { x: 22, y: 84, w: 18, delay: 0 },
  { x: 18, y: 86, w: 14, delay: 0.7 },
  { x: 26, y: 83, w: 10, delay: 1.4 },
  { x: 8, y: 90, w: 16, delay: 0.35 },
  { x: 14, y: 88, w: 12, delay: 2.1 },
  { x: 4, y: 92, w: 20, delay: 1.0 },
  { x: 30, y: 85, w: 8, delay: 1.8 },
];

const CLOUDS: { x: number; y: number; w: number; h: number; dur: number; delay: number }[] = [
  { x: 10, y: 15, w: 14, h: 6, dur: 25, delay: 0 },
  { x: 55, y: 30, w: 12, h: 5, dur: 30, delay: 8 },
  { x: 25, y: 55, w: 15, h: 7, dur: 22, delay: 14 },
  { x: 70, y: 20, w: 10, h: 4, dur: 28, delay: 5 },
];

export default function VillageVFX() {
  return (
    <div className="village-vfx" aria-hidden="true">
      {/* Campfire embers */}
      <div className="vfx-campfire" style={{ left: "58%", top: "74%" }}>
        <div className="vfx-glow" />
        {EMBERS.map((e, i) => (
          <div
            key={i}
            className="vfx-ember"
            style={{
              left: `calc(50% + ${e.dx}px)`,
              top: `calc(50% + ${e.dy}px)`,
              width: `${e.size}px`,
              height: `${e.size}px`,
              backgroundColor: e.color,
              animationDelay: `${e.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Water shimmer */}
      {SHIMMER_BARS.map((bar, i) => (
        <div
          key={`shimmer-${i}`}
          className="vfx-shimmer"
          style={{
            left: `${bar.x}%`,
            top: `${bar.y}%`,
            width: `${bar.w}px`,
            animationDelay: `${bar.delay}s`,
          }}
        />
      ))}

      {/* Cloud shadows */}
      {CLOUDS.map((c, i) => (
        <div
          key={`cloud-${i}`}
          className="vfx-cloud"
          style={
            {
              left: `${c.x}%`,
              top: `${c.y}%`,
              width: `${c.w}%`,
              height: `${c.h}%`,
              animationDuration: `${c.dur}s`,
              animationDelay: `${c.delay}s`,
            } as CSSProperties
          }
        />
      ))}

      {/* Ambient warm tint */}
      <div className="vfx-ambient" />
    </div>
  );
}
