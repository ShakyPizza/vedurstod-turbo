import { cached } from '../cache.js';
import { fetchImoJson } from './imo-api.js';

const STATION_TTL = 24 * 60 * 60 * 1000;
const API_VERSION = '2026-02-17';

// Station metadata from the IMO Weather API (`/weather/stations/{id}`).
// Replaces the old scrape of www.vedur.is/vedur/stodvar/, which the new
// vedur.is site removed.
async function loadStation(id) {
  let s;
  try {
    s = await fetchImoJson(`/weather/stations/${id}`, { apiVersion: API_VERSION });
  } catch (err) {
    if (err?.statusCode === 404) {
      const nf = new Error(`station ${id} not found`);
      nf.statusCode = 404;
      throw nf;
    }
    throw err;
  }
  const lat = Number(s?.lat);
  const lon = Number(s?.lon);
  if (!s || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    const err = new Error(`coords missing for station ${id}`);
    err.statusCode = 502;
    throw err;
  }
  return {
    id,
    name: String(s.name ?? `stöð ${id}`),
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
  };
}

export function getStationInfo(id) {
  return cached(`station-info:${id}`, STATION_TTL, () => loadStation(id));
}
