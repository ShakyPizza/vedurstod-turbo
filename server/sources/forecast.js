import { cached } from '../cache.js';
import { fetchXml, num, parseVedurTime, STATION_ID, STATION_NAME } from './vedur.js';

const TTL = 60 * 60 * 1000;

async function load() {
  const data = await fetchXml({
    op_w: 'xml',
    type: 'forec',
    lang: 'is',
    view: 'xml',
    ids: String(STATION_ID),
  });

  const stations = data?.forecasts?.station ?? [];
  const s = Array.isArray(stations) ? stations[0] : stations;
  if (!s) throw new Error('no forecast data');

  const entries = Array.isArray(s.forecast) ? s.forecast : s.forecast ? [s.forecast] : [];

  return {
    stationId: STATION_ID,
    stationName: String(s.name ?? STATION_NAME),
    issuedAt: parseVedurTime(s.atime),
    fetchedAt: new Date().toISOString(),
    steps: entries.map((e) => ({
      time: parseVedurTime(e.ftime),
      temperature: num(e.T),
      windSpeed: num(e.F),
      windDirection: e.D ? String(e.D).trim() : null,
      state: e.W ? String(e.W) : null,
    })),
  };
}

export function getForecast() {
  return cached('forecast', TTL, load);
}
