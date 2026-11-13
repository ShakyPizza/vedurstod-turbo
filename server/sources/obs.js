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
const MAX_MULTI = 30;

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

/** Latest temperature and wind for several stations in one upstream call. */
export function getObservations(ids) {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_MULTI).sort((a, b) => a - b);
  if (clean.length === 0) return Promise.resolve({ fetchedAt: new Date().toISOString(), stations: [] });
  return cached(`obs-multi:${clean.join(',')}`, MULTI_TTL, () => loadMany(clean), {
    shouldCache: (r) => r.stations.some((s) => s.temperature !== null),
  });
}
