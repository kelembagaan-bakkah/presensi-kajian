const EARTH_RADIUS = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Jarak dua titik koordinat dalam meter (rumus haversine). */
export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

/** Selisih posisi (timur = dx, utara = dy) dalam meter dari titik pusat. */
export function offsetMeters(lat0, lng0, lat, lng) {
  return {
    dx: toRad(lng - lng0) * EARTH_RADIUS * Math.cos(toRad(lat0)),
    dy: toRad(lat - lat0) * EARTH_RADIUS,
  };
}
