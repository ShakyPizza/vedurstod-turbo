import { cached } from '../cache.js';
import { fetchXml, num, parseVedurTime } from './vedur.js';
import { DEFAULT_STATION } from '../config.js';

const TTL = 10 * 60 * 1000;

async function load(stationId) {
  const data = await fetchXml({
    op_w: 'xml',
    type: 'obs',
    lang: 'is',
    view: 'xml',
    ids: String(stationId),
    params: 'T;F;FX;FG;D;R;RH;P;N;TD;V',
    time: '1h',
  });

  const stations = data?.observations?.station ?? [];
  const s = Array.isArray(stations) ? stations[0] : stations;
  if (!s) return { stationId, stationName: `stöð ${stationId}`, observedAt: null, fetchedAt: new Date().toISOString(), temperature: null, dewPoint: null, humidity: null, pressure: null, precipitation: null, cloudCover: null, visibility: null, wind: { speed: null, gust: null, max: null, direction: null } };

  return {
    stationId,
    stationName: String(s.name ?? `stöð ${stationId}`),
    observedAt: parseVedurTime(s.time),
    fetchedAt: new Date().toISOString(),
    temperature: num(s.T),
    dewPoint: num(s.TD),
    humidity: num(s.RH),
    pressure: num(s.P),
    precipitation: num(s.R),
    cloudCover: s.N ? String(s.N) : null,
    visibility: num(s.V),
    wind: {
      speed: num(s.F),
      gust: num(s.FG),
      max: num(s.FX),
      direction: s.D ? String(s.D).trim() : null,
    },
  };
}

function hasAnyReading(obs) {
  return (
    obs.temperature !== null ||
    obs.humidity !== null ||
    obs.pressure !== null ||
    obs.dewPoint !== null ||
    obs.wind.speed !== null ||
    obs.wind.gust !== null ||
    obs.wind.direction !== null
  );
}

export function getObservation(stationId = DEFAULT_STATION.id) {
  return cached(`obs:${stationId}`, TTL, () => load(stationId), {
    shouldCache: hasAnyReading,
  });
}

const MULTI_TTL = 10 * 60 * 1000;
// After a failed or empty upstream answer, wait this long before trying again.
const MULTI_FAIL_TTL = 2 * 60 * 1000;

// Stations on the KORT panel (keep in step with MAP_STATIONS in
// web/panels/map.ts). Only these are served, always fetched together in one
// upstream call, so callers cannot make the server query vedur.is for
// arbitrary station sets.
export const MAP_STATION_IDS = Object.freeze([
  1, 178, 571, 990, 2319, 2644, 3317, 3433, 3471, 3696, 4828, 5544, 6015, 6272, 6300, 6670, 6748, 6935,
]);
const MAP_STATION_SET = new Set(MAP_STATION_IDS);

function parseStation(s) {
  return {
    stationId: Number(s.id),
    stationName: String(s.name ?? `stöð ${s.id}`),
    observedAt: parseVedurTime(s.time),
    temperature: num(s.T),
    wind: {
      speed: num(s.F),
      gust: num(s.FG),
      direction: s.D ? String(s.D).trim() : null,
    },
  };
}

async function loadMany(ids) {
  const data = await fetchXml({
    op_w: 'xml',
    type: 'obs',
    lang: 'is',
    view: 'xml',
    ids: ids.join(';'),
    params: 'T;F;FG;D',
    time: '1h',
  });
  const stations = data?.observations?.station ?? [];
  const list = Array.isArray(stations) ? stations : [stations];
  return {
    fetchedAt: new Date().toISOString(),
    stations: list.filter((s) => s && s.id).map(parseStation),
  };
}

/**
 * Latest temperature and wind for the map stations. Every caller shares one
 * cached upstream call (at most one per 10 minutes, or per 2 minutes while
 * vedur.is fails). `ids` only narrows the answer; IDs outside the map list
 * are ignored, and an empty list means all map stations.
 */
export async function getObservations(ids = []) {
  const all = await cached('obs-multi:map', MULTI_TTL, () => loadMany(MAP_STATION_IDS), {
    shouldCache: (r) => r.stations.some((s) => s.temperature !== null),
    failTtlMs: MULTI_FAIL_TTL,
  });
  if (ids.length === 0) return all;
  const wanted = new Set(ids.filter((n) => MAP_STATION_SET.has(n)));
  return { ...all, stations: all.stations.filter((s) => wanted.has(s.stationId)) };
}
