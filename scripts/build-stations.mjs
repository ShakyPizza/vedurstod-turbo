#!/usr/bin/env node
// Rebuild web/stations.json (the station dropdown) from the IMO Weather API.
//
//   node scripts/build-stations.mjs
//
// Keeps active automatic (sj) and manned (sk) stations that currently report
// temperature or wind on xmlweather.vedur.is, which the obs panel reads.
// Stations are grouped by IMO forecast region and sorted by Icelandic name.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.vedur.is/weather';
const XML = 'https://xmlweather.vedur.is/';
const OUT = fileURLToPath(new URL('../web/stations.json', import.meta.url));
const UA = 'vedurstod-turbo/0.8 (+weather dashboard)';

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
const KEEP_TYPES = new Set(['sj', 'sk']);

// Stations the /stations list leaves out (other types) but that report data.
const EXTRA = [{ id: 571, region: 'Austurland að Glettingi' }];

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'x-vi-api-version': '2026-02-17' } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function reporting(ids) {
  const live = new Set();
  for (let i = 0; i < ids.length; i += 60) {
    const url = new URL(XML);
    url.search = new URLSearchParams({
      op_w: 'xml', type: 'obs', lang: 'is', view: 'xml', params: 'T;F', time: '1h',
      ids: ids.slice(i, i + 60).join(';'),
    }).toString();
    const xml = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
    for (const m of xml.matchAll(/<station id="(\d+)"[^>]*>([\s\S]*?)<\/station>/g)) {
      if (/<T>[^<]+<\/T>|<F>[^<]+<\/F>/.test(m[2])) live.add(Number(m[1]));
    }
  }
  return live;
}

const round = (n) => Math.round(n * 10000) / 10000;
const byName = new Intl.Collator('is').compare;

const candidates = [];
for (const [regionId, region] of REGIONS) {
  const list = await getJson(`${API}/stations?region_id=${regionId}`);
  for (const s of list) {
    if (s.ending !== null || !KEEP_TYPES.has(s.type)) continue;
    candidates.push({ id: s.station, name: s.name, lat: round(s.lat), lon: round(s.lon), region });
  }
}
for (const { id, region } of EXTRA) {
  if (candidates.some((c) => c.id === id)) continue;
  const s = await getJson(`${API}/stations/${id}`);
  candidates.push({ id, name: s.name, lat: round(s.lat), lon: round(s.lon), region });
}

const live = await reporting(candidates.map((c) => c.id));
const seen = new Set();
const stations = candidates
  .filter((c) => live.has(c.id) && !seen.has(c.id) && seen.add(c.id))
  .sort((a, b) => {
    const ra = REGIONS.findIndex(([, r]) => r === a.region);
    const rb = REGIONS.findIndex(([, r]) => r === b.region);
    return ra - rb || byName(a.name, b.name);
  });

const body = '[\n' + stations.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n';
await writeFile(OUT, body);
console.log(`wrote ${stations.length} stations to ${OUT}`);
