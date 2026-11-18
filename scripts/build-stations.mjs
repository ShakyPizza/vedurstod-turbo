#!/usr/bin/env node
// Rebuild web/stations.json (the station dropdown) from the IMO Weather API.
//
//   node scripts/build-stations.mjs
//
// The dropdown is a short, hand-picked list of main and capital-area
// stations. To add or remove one, edit CURATED below and run the script.
// Coordinates and forecast regions come from the API, so they stay correct.
// Any other station can still be added by typing its number in the dialog.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.vedur.is/weather';
const OUT = fileURLToPath(new URL('../web/stations.json', import.meta.url));
const UA = 'vedurstod-turbo/0.8 (+weather dashboard)';

// [station id, display name]
const CURATED = [
  [1471, 'Seltjarnarnes Suðurnes'],
  [1475, 'Reykjavík'],
  [1477, 'Reykjavíkurflugvöllur'],
  [990, 'Keflavíkurflugvöllur'],
  [1453, 'Garðskagaviti'],
  [1395, 'Eyrarbakki'],
  [6300, 'Selfoss'],
  [6315, 'Hella'],
  [6015, 'Vestmannaeyjabær'],
  [6272, 'Kirkjubæjarklaustur'],
  [6499, 'Skaftafell'],
  [178, 'Stykkishólmur'],
  [1924, 'Ólafsvík'],
  [1938, 'Grundarfjörður'],
  [2481, 'Hólmavík'],
  [2319, 'Patreksfjörður'],
  [2428, 'Bíldudalur'],
  [2631, 'Flateyri'],
  [2644, 'Ísafjörður Tungudalur'],
  [2738, 'Bolungarvík'],
  [3317, 'Blönduós'],
  [3433, 'Sauðárkrókur flugvöllur'],
  [3752, 'Siglufjörður'],
  [3658, 'Ólafsfjörður'],
  [3471, 'Akureyri'],
  [3696, 'Húsavík'],
  [4300, 'Mývatn'],
  [4406, 'Krafla'],
  [4500, 'Þeistareykir'],
  [4614, 'Ásbyrgi'],
  [4828, 'Raufarhöfn'],
  [571, 'Egilsstaðaflugvöllur'],
  [4060, 'Hallormsstaður'],
  [4182, 'Seyðisfjörður'],
  [5981, 'Eskifjörður'],
  [5990, 'Neskaupstaður'],
  [5544, 'Höfn í Hornafirði'],
  [6935, 'Hveravellir'],
];

const REGIONS = [
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

// Stations the region lists leave out (other station types).
const REGION_FALLBACK = { 571: 'Austurland að Glettingi' };

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'x-vi-api-version': '2026-02-17' } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

const regionOf = new Map();
for (const [regionId, region] of REGIONS) {
  // The capital area also appears in Faxaflói; the first (smaller) region wins.
  for (const s of await getJson(`${API}/stations?region_id=${regionId}`)) {
    if (!regionOf.has(s.station)) regionOf.set(s.station, region);
  }
}

const round = (n) => Math.round(n * 10000) / 10000;
const byName = new Intl.Collator('is').compare;
const regionIndex = (r) => REGIONS.findIndex(([, name]) => name === r);

const stations = [];
for (const [id, name] of CURATED) {
  const s = await getJson(`${API}/stations/${id}`);
  const region = regionOf.get(id) ?? REGION_FALLBACK[id];
  if (!region) throw new Error(`no region for station ${id}; add it to REGION_FALLBACK`);
  stations.push({ id, name, lat: round(s.lat), lon: round(s.lon), region });
}
stations.sort((a, b) => regionIndex(a.region) - regionIndex(b.region) || byName(a.name, b.name));

const body = '[\n' + stations.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n';
await writeFile(OUT, body);
console.log(`wrote ${stations.length} stations to ${OUT}`);
