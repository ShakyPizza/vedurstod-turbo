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

// IMO forecast regions, in the order the station list shows them.
export const REGIONS = [
  [1, 'Höfuðborgarsvæðið'],
  [2, 'Suðurland'],
  [3, 'Faxaflói'],
  [4, 'Breiðafjörður'],
  [5, 'Vestfirðir'],
  [6, 'Strandir og Norðurland vestra'],
  [7, 'Norðurland eystra'],
  [8, 'Austurland að Glettingi'],
  [9, 'Austfirðir'],
  [10, 'Suðausturland'],
  [11, 'Miðhálendið'],
];

// Station types that measure temperature and wind. `ur` (precipitation
// only) is left out because the dashboard has nothing to show for it.
const STATION_TYPES = {
  sj: 'Sjálfvirk',
  sk: 'Mönnuð',
  vf: 'Vegagerðin',
};

// All active weather stations, grouped by forecast region and sorted by name.
// One API call per region; the capital area also appears in Faxaflói, so the
// first region a station is seen in wins.
async function loadStationList() {
  const byName = new Intl.Collator('is').compare;
  const seen = new Set();
  const stations = [];
  for (const [regionId, region] of REGIONS) {
    const list = await fetchImoJson('/weather/stations', {
      params: { region_id: regionId },
      apiVersion: API_VERSION,
    });
    const inRegion = (Array.isArray(list) ? list : [])
      .filter((s) => s.ending === null && STATION_TYPES[s.type] && !seen.has(s.station))
      .map((s) => ({
        id: Number(s.station),
        name: String(s.name),
        region,
        type: STATION_TYPES[s.type],
        owner: s.owner ? String(s.owner) : null,
        elevation: Number.isFinite(Number(s.ele)) ? Math.round(Number(s.ele)) : null,
        lat: Number.isFinite(Number(s.lat)) ? Math.round(Number(s.lat) * 10000) / 10000 : null,
        lon: Number.isFinite(Number(s.lon)) ? Math.round(Number(s.lon) * 10000) / 10000 : null,
      }))
      .sort((a, b) => byName(a.name, b.name));
    for (const s of inRegion) seen.add(s.id);
    stations.push(...inRegion);
  }
  return { fetchedAt: new Date().toISOString(), stations };
}

export function getStationList() {
  return cached('station-list', STATION_TTL, loadStationList, {
    shouldCache: (r) => r.stations.length > 0,
    failTtlMs: 5 * 60 * 1000,
  });
}
