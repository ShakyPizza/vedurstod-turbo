import { cached } from '../cache.js';
import { fetchXml, num, parseVedurTime, STATION_ID, STATION_NAME } from './vedur.js';

const TTL = 10 * 60 * 1000;

async function load() {
  const data = await fetchXml({
    op_w: 'xml',
    type: 'obs',
    lang: 'is',
    view: 'xml',
    ids: String(STATION_ID),
    params: 'T;F;FX;FG;D;R;RH;P;N;TD;V',
    time: '1h',
  });

  const stations = data?.observations?.station ?? [];
  const s = Array.isArray(stations) ? stations[0] : stations;
  if (!s) throw new Error('no station data');

  return {
    stationId: STATION_ID,
    stationName: String(s.name ?? STATION_NAME),
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

export function getObservation() {
  return cached('obs', TTL, load);
}
