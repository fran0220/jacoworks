export const YIZHUANG_CENTER = { lng: 116.506, lat: 39.795 };
export const PROJECTION_SCALE = 10000;

const COS_CENTER_LAT = Math.cos(YIZHUANG_CENTER.lat * (Math.PI / 180));

/** 经纬度 → Three.js [x, z] */
export function lngLatToWorld(lng: number, lat: number): [number, number] {
  const x =
    (lng - YIZHUANG_CENTER.lng) * PROJECTION_SCALE * COS_CENTER_LAT;
  const z = -(lat - YIZHUANG_CENTER.lat) * PROJECTION_SCALE;
  return [x, z];
}

/** Three.js [x, z] → 经纬度 */
export function worldToLngLat(x: number, z: number): [number, number] {
  const lng =
    x / (PROJECTION_SCALE * COS_CENTER_LAT) + YIZHUANG_CENTER.lng;
  const lat = -(z / PROJECTION_SCALE) + YIZHUANG_CENTER.lat;
  return [lng, lat];
}

/** 两个经纬度点的距离(米) — Haversine */
export function geoDistance(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
