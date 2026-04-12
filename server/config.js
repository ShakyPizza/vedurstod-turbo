export const DEFAULT_STATION = {
  id: 1471,
  name: 'Seltjarnarnes Suðurnes',
  lat: 64.1542,
  lon: -22.027,
};

export function resolveStationId(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_STATION.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_STATION.id;
}

export function resolveCoord(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
