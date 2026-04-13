import type { Station } from './panels/types.ts';

const KEY = 'vedurstod:station';

export const DEFAULT_STATION: Station = {
  id: 1471,
  name: 'Seltjarnarnes Suðurnes',
  lat: 64.1542,
  lon: -22.027,
};

export function loadStation(): Station {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATION;
    const parsed = JSON.parse(raw) as Partial<Station>;
    if (
      typeof parsed?.id === 'number' &&
      typeof parsed?.name === 'string' &&
      typeof parsed?.lat === 'number' &&
      typeof parsed?.lon === 'number'
    ) {
      return {
        id: parsed.id,
        name: parsed.name,
        lat: parsed.lat,
        lon: parsed.lon,
        ...(typeof parsed.forecastId === 'number' ? { forecastId: parsed.forecastId } : {}),
      };
    }
  } catch {
    // fall through
  }
  return DEFAULT_STATION;
}

export function saveStation(s: Station) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearStation() {
  localStorage.removeItem(KEY);
}
