import { readFileSync } from 'node:fs';
import { cached } from '../cache.js';
import { fetchXml, num, parseVedurTime } from './vedur.js';

// Forecasts for every station on the Landsspá page (/landid), fetched from
// xmlweather.vedur.is in one call and shared by all visitors. The station
// list is server/data/landsspa-stations.json (built by
// scripts/build-landsspa-stations.mjs); only those stations are served, so
// callers cannot make the server query vedur.is for arbitrary stations.

const CATALOGUE = JSON.parse(
  readFileSync(new URL('../data/landsspa-stations.json', import.meta.url), 'utf8'),
);
export const LANDSSPA_IDS = Object.freeze(CATALOGUE.stations.map((s) => s.id));
const ID_SET = new Set(LANDSSPA_IDS);
const OVERVIEW_IDS = CATALOGUE.stations.filter((s) => s.overview).map((s) => s.id);

const TTL = 30 * 60 * 1000;
// After a failed or empty upstream answer, wait this long before trying again.
const FAIL_TTL = 3 * 60 * 1000;

async function load() {
  const data = await fetchXml({
    op_w: 'xml',
    type: 'forec',
    lang: 'is',
    view: 'xml',
    ids: LANDSSPA_IDS.join(';'),
    // R (precipitation) is only sent when asked for.
    params: 'F;D;T;W;R',
  });
  const list = data?.forecasts?.station ?? [];
  const raw = (Array.isArray(list) ? list : [list]).filter((s) => s && s.id);

  // One shared time axis: the union of all forecast times, in order.
  const timeSet = new Set();
  let issuedAt = null;
  for (const s of raw) {
    const at = parseVedurTime(s.atime);
    if (at && (!issuedAt || at > issuedAt)) issuedAt = at;
    for (const f of s.forecast ?? []) {
      const t = parseVedurTime(f.ftime);
      if (t) timeSet.add(t);
    }
  }
  const times = [...timeSet].sort();
  const index = new Map(times.map((t, i) => [t, i]));

  // Weather words repeat a lot; send each once and refer to it by number.
  const weather = [];
  const weatherIndex = new Map();
  const wid = (w) => {
    if (!w) return -1;
    if (!weatherIndex.has(w)) {
      weatherIndex.set(w, weather.length);
      weather.push(w);
    }
    return weatherIndex.get(w);
  };

  const stations = {};
  for (const s of raw) {
    const n = times.length;
    const row = {
      T: new Array(n).fill(null),
      F: new Array(n).fill(null),
      D: new Array(n).fill(null),
      W: new Array(n).fill(-1),
      R: new Array(n).fill(null),
    };
    for (const f of s.forecast ?? []) {
      const i = index.get(parseVedurTime(f.ftime));
      if (i === undefined) continue;
      row.T[i] = num(f.T);
      row.F[i] = num(f.F);
      row.D[i] = f.D ? String(f.D).trim() : null;
      row.W[i] = wid(f.W ? String(f.W).trim() : null);
      row.R[i] = num(f.R);
    }
    stations[Number(s.id)] = row;
  }

  return { issuedAt, fetchedAt: new Date().toISOString(), times, weather, stations };
}

/**
 * Forecasts for the given Landsspá stations (all overview stations when
 * `ids` is empty). IDs outside the station list are ignored.
 */
export async function getLandsspa(ids = []) {
  const all = await cached('landsspa', TTL, load, {
    shouldCache: (r) => Object.keys(r.stations).length > 0 && r.times.length > 0,
    failTtlMs: FAIL_TTL,
  });
  const wanted = (ids.length ? ids : OVERVIEW_IDS).filter((id) => ID_SET.has(id));
  const stations = {};
  for (const id of wanted) if (all.stations[id]) stations[id] = all.stations[id];
  return { ...all, stations };
}
