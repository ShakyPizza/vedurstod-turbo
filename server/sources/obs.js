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

export function getObservation(stationId = DEFAULT_STATION.id) {
  return cached(`obs:${stationId}`, TTL, () => load(stationId));
}
