#!/usr/bin/env node
// Rebuild server/data/landsspa-stations.json, the station list for the
// Landsspá page (/landid).
//
//   node scripts/build-landsspa-stations.mjs
//
// Three groups:
// - OVERVIEW: the stations on the old vedur.is "Staðaspár – Yfirlitsstöðvar"
//   map. They are shown on the whole-country view. The order is the label
//   placement priority: earlier stations get their label placed first.
// - METRO: the capital-area view, the same stations as the KORT panel.
// - Every other active automatic or staffed station owned by Veðurstofa
//   Íslands. The zoomed regions use these to fill in the map.
// Only stations that xmlweather.vedur.is has a forecast for are kept.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.vedur.is/weather';
const XML = 'https://xmlweather.vedur.is/';
const OUT = fileURLToPath(new URL('../server/data/landsspa-stations.json', import.meta.url));
const UA = 'vedurstod-turbo/0.8 (+weather dashboard)';
const API_VERSION = '2026-02-17';

// [station id, short name]. Some old-map dots have two station numbers at
// the same place; these are the ones with a forecast.
const OVERVIEW = [
  [1, 'Reykjavík'],
  [3471, 'Akureyri'],
  [571, 'Egilsstaðir'],
  [2738, 'Bolungarvík'],
  [5544, 'Höfn'],
  [6017, 'Stórhöfði'],
  [178, 'Stykkishólmur'],
  [3696, 'Húsavík'],
  [4828, 'Raufarhöfn'],
  [2319, 'Patreksfjörður'],
  [3752, 'Siglufjörður'],
  [3317, 'Blönduós'],
  [6272, 'Kirkjubæjarklaustur'],
  [6935, 'Hveravellir'],
  [2481, 'Hólmavík'],
  [293, 'Litla-Ávík'],
  [4455, 'Skjaldþingsstaðir'],
  [4323, 'Grímsstaðir'],
  [3292, 'Svartárkot'],
  [5933, 'Kárahnjúkar'],
  [35315, 'Kvísker'],
  [6420, 'Árnes'],
  [1781, 'Stafholtsey'],
  [32097, 'Holtavörðuheiði'],
  [6657, 'Veiðivatnahraun'],
];

const METRO = [
  [1, 'Reykjavík'],
  [1477, 'Flugvöllur'],
  [1471, 'Seltjarnarnes'],
  [1478, 'Geirsnef'],
  [1472, 'Kópavogur'],
  [1474, 'Garðabær'],
  [1473, 'Straumsvík'],
  [1480, 'Geldinganes'],
  [1482, 'Víðidalur'],
  [1481, 'Hólmsheiði'],
  [1578, 'Skrauthólar'],
  [1579, 'Mosfellsbær'],
];

// Shorter names for regional stations whose IMO name is long.
const SHORT = {
  990: 'Keflavík',
  1453: 'Garðskagi',
  1350: 'Keflavíkurflugvöllur',
};

// Staffed or forecast-only numbers that the station API lists under another
// number at the same place: borrow that station's coordinates.
const COORDS_FROM = { 293: 2691, 571: 4271, 35315: 5316 };

const HIGHLAND_M = 500;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'x-vi-api-version': API_VERSION } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

// All stations, keyed by number, with the forecast region they belong to.
const all = new Map();
for (let region = 1; region <= 11; region++) {
  for (const s of await getJson(`${API}/stations?region_id=${region}`)) {
    if (!all.has(s.station)) all.set(s.station, { ...s, region });
  }
}

const isImo = (s) => /(^|, )Veðurstofa Íslands$/.test(String(s.owner ?? ''));
const candidates = new Set([
  ...OVERVIEW.map(([id]) => id),
  ...METRO.map(([id]) => id),
  ...[...all.values()]
    .filter((s) => s.ending === null && (s.type === 'sj' || s.type === 'sk') && isImo(s) && s.station < 10000)
    .map((s) => s.station),
]);

// Which of them have a forecast? Ask in batches.
async function forecastIds(ids) {
  const url = new URL(XML);
  url.search = new URLSearchParams({ op_w: 'xml', type: 'forec', lang: 'is', view: 'xml', ids: ids.join(';') });
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  const text = await res.text();
  const ok = new Set();
  for (const m of text.matchAll(/<station id="(\d+)"[^>]*>([\s\S]*?)<\/station>/g)) {
    if ((m[2].match(/<forecast>/g) ?? []).length >= 50) ok.add(Number(m[1]));
  }
  return ok;
}
const withForecast = new Set();
const list = [...candidates];
for (let i = 0; i < list.length; i += 60) {
  for (const id of await forecastIds(list.slice(i, i + 60))) withForecast.add(id);
}

const round = (n) => Math.round(n * 10000) / 10000;
const overviewRank = new Map(OVERVIEW.map(([id], i) => [id, i + 1]));
const metroName = new Map(METRO);
const overviewName = new Map(OVERVIEW);
const shortName = (s) => String(s.name).split(' - ')[0].trim();

const stations = [];
const skipped = [];
for (const id of list) {
  if (!withForecast.has(id)) {
    skipped.push(id);
    continue;
  }
  const meta = all.get(id) ?? all.get(COORDS_FROM[id]);
  if (!meta) {
    skipped.push(id);
    continue;
  }
  const ele = Number.isFinite(Number(meta.ele)) ? Math.round(Number(meta.ele)) : null;
  const entry = {
    id,
    name: String(all.get(id)?.name ?? meta.name),
    short: overviewName.get(id) ?? metroName.get(id) ?? SHORT[id] ?? shortName(all.get(id) ?? meta),
    lat: round(meta.lat),
    lon: round(meta.lon),
    ele,
  };
  if (overviewRank.has(id)) entry.overview = overviewRank.get(id);
  if (metroName.has(id)) entry.metro = true;
  if (ele !== null && ele >= HIGHLAND_M) entry.highland = true;
  if (all.get(id)?.type === 'sk') entry.staffed = true;
  stations.push(entry);
}

// Overview first (in priority order), then staffed, then by number.
stations.sort(
  (a, b) =>
    (a.overview ?? 99) - (b.overview ?? 99) || (b.staffed ? 1 : 0) - (a.staffed ? 1 : 0) || a.id - b.id,
);

const body =
  '{\n  "generatedAt": ' +
  JSON.stringify(new Date().toISOString().slice(0, 10)) +
  ',\n  "stations": [\n' +
  stations.map((s) => '    ' + JSON.stringify(s)).join(',\n') +
  '\n  ]\n}\n';
await writeFile(OUT, body);
console.log(`wrote ${stations.length} stations to ${OUT}`);
if (skipped.length) console.log(`no forecast or no coordinates, left out: ${skipped.join(', ')}`);
