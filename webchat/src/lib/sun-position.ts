import SunCalc from "suncalc";

const LAT = 39.768;
const LNG = 116.563;

export type LightPreset = "dawn" | "day" | "dusk" | "night";

export function getSunPosition(date?: Date): { azimuth: number; altitude: number } {
  const d = date ?? new Date();
  const pos = SunCalc.getPosition(d, LAT, LNG);
  return {
    azimuth: (pos.azimuth * 180) / Math.PI,
    altitude: (pos.altitude * 180) / Math.PI,
  };
}

export function getLightPreset(date?: Date): LightPreset {
  const d = date ?? new Date();
  const times = SunCalc.getTimes(d, LAT, LNG);
  const now = d.getTime();

  if (now < times.dawn.getTime() || now > times.night.getTime()) return "night";
  if (now < times.sunrise.getTime()) return "dawn";
  if (now < times.sunsetStart.getTime()) return "day";
  if (now < times.night.getTime()) return "dusk";
  return "night";
}

export function getSunDirection(date?: Date): [number, number] {
  const { azimuth, altitude } = getSunPosition(date);
  return [azimuth, altitude];
}
