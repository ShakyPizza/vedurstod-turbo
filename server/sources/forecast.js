import { cached } from '../cache.js';
import { fetchXml, num, parseVedurTime } from './vedur.js';
import { DEFAULT_STATION } from '../config.js';

const TTL = 60 * 60 * 1000;

async function load(stationId) {
  const data = await fetchXml({
    op_w: 'xml',
    type: 'forec',
    lang: 'is',
    view: 'xml',
    ids: String(stationId),
  });

  const stations = data?.forecasts?.station ?? [];
  const s = Array.isArray(stations) ? stations[0] : stations;
  if (!s) return { stationId, stationName: `stöð ${stationId}`, issuedAt: null, fetchedAt: new Date().toISOString(), steps: [] };

  const entries = Array.isArray(s.forecast) ? s.forecast : s.forecast ? [s.forecast] : [];

  return {
    stationId,
    stationName: String(s.name ?? `stöð ${stationId}`),
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

export function getForecast(stationId = DEFAULT_STATION.id) {
  return cached(`forecast:${stationId}`, TTL, () => load(stationId));
}
