#!/usr/bin/env node
// Rebuild the Landsspá coastline from OpenStreetMap (natural=coastline).
//
//   node scripts/build-coastline.mjs
//
// Writes two detail levels in the projection of web/panels/iceland-shape.ts:
// - web/landid/coast-lo.ts: the whole-country view, bundled with the page.
// - web/public/data/coast-hi.json: the zoomed regions, fetched when needed.
// Paths are written as integer relative moves in map units × q, so the page
// draws them with transform="scale(1/q)".
// Data © OpenStreetMap contributors (ODbL). Credit is in the page footer.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const QUERY = '[out:json][timeout:300];way["natural"="coastline"](63.0,-25.0,66.8,-13.0);out skel geom qt;';
const UA = 'vedurstod-turbo/0.8 (+weather dashboard; coastline build)';
const OUT_LO = fileURLToPath(new URL('../web/landid/coast-lo.ts', import.meta.url));
const OUT_HI = fileURLToPath(new URL('../web/public/data/coast-hi.json', import.meta.url));

// Same projection as web/panels/iceland-shape.ts. Keep in step.
const LON0 = -24.75;
const LAT1 = 66.65;
const COS = 0.42261826174069944;
const K = 204.86593793528124;
const project = (lat, lon) => [(lon - LON0) * COS * K, (LAT1 - lat) * K];

// tol: Douglas-Peucker tolerance in map units (1 unit ≈ 540 m).
// minArea: drop islets smaller than this (map units²; 1 unit² ≈ 0.29 km²).
const LEVELS = {
  lo: { tol: 0.5, minArea: 1.5, q: 10 },
  hi: { tol: 0.045, minArea: 0.015, q: 40 },
};

console.log('fetching coastline from Overpass…');
const res = await fetch(OVERPASS, {
  method: 'POST',
  headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: QUERY }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const ways = (await res.json()).elements.filter((e) => e.type === 'way');
console.log(`${ways.length} ways`);

// Join ways end to start into closed rings.
const byStart = new Map();
for (const w of ways) {
  const k = w.nodes[0];
  if (!byStart.has(k)) byStart.set(k, []);
  byStart.get(k).push(w);
}
const used = new Set();
const rings = [];
let open = 0;
for (const w of ways) {
  if (used.has(w)) continue;
  used.add(w);
  const nodes = [...w.nodes];
  const geom = [...w.geometry];
  while (nodes[nodes.length - 1] !== nodes[0]) {
    const next = (byStart.get(nodes[nodes.length - 1]) ?? []).find((x) => !used.has(x));
    if (!next) {
      open++;
      break;
    }
    used.add(next);
    nodes.push(...next.nodes.slice(1));
    geom.push(...next.geometry.slice(1));
  }
  rings.push(geom.map((g) => project(g.lat, g.lon)));
}
console.log(`${rings.length} rings, ${open} left open`);

function area(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i === 0 ? r.length - 1 : i - 1];
    const [x1, y1] = r[i];
    a += x1 * y0 - x0 * y1;
  }
  return Math.abs(a) / 2;
}

function simplify(pts, tol) {
  const n = pts.length;
  if (n < 4) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len > 0 ? Math.abs(dx * (ay - py) - (ax - px) * dy) / len : Math.hypot(px - ax, py - ay);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function encode(rs, q) {
  let out = '';
  for (const r of rs) {
    const pts = [];
    for (const [x, y] of r) {
      const p = [Math.round(x * q), Math.round(y * q)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    const first = pts[0];
    const end = pts[pts.length - 1];
    if (pts.length > 1 && first[0] === end[0] && first[1] === end[1]) pts.pop();
    if (pts.length < 3) continue;
    const moves = [];
    for (let i = 1; i < pts.length; i++) moves.push(`${pts[i][0] - pts[i - 1][0]} ${pts[i][1] - pts[i - 1][1]}`);
    out += `M${pts[0][0]} ${pts[0][1]}l${moves.join(' ').replace(/ -/g, '-')}z`;
  }
  return out;
}

const result = {};
for (const [name, { tol, minArea, q }] of Object.entries(LEVELS)) {
  const kept = [];
  for (const r of rings) {
    if (r.length < 3 || area(r) < minArea) continue;
    // Simplify each half separately so the ring's two ends are not the same point.
    const h = Math.floor(r.length / 2);
    const s = [...simplify(r.slice(0, h + 1), tol).slice(0, -1), ...simplify([...r.slice(h), r[0]], tol)];
    if (s.length >= 3) kept.push(s);
  }
  result[name] = { q, d: encode(kept, q) };
  console.log(`${name}: ${kept.length} rings, ${kept.reduce((n, r) => n + r.length, 0)} points, ${result[name].d.length} chars`);
}

await mkdir(dirname(OUT_HI), { recursive: true });
await writeFile(OUT_HI, JSON.stringify(result.hi));
await writeFile(
  OUT_LO,
  `// Generated by scripts/build-coastline.mjs. Do not edit by hand.\n` +
    `// Coastline © OpenStreetMap contributors (ODbL).\n` +
    `export const COAST_LO = ${JSON.stringify(result.lo)};\n`,
);
console.log(`wrote ${OUT_LO} and ${OUT_HI}`);
