#!/usr/bin/env node
// Rebuild the extra map layers for the Landsspá page: glaciers, large lakes
// and reservoirs, and the two highland crossings (Kjalvegur, road 35, and
// Sprengisandsleið, F26). Two files:
// - web/public/data/highland.json: the Hálendið view, detailed.
// - web/public/data/country.json: the whole-country view, coarser, with
//   only the larger glaciers and lakes.
//
//   node scripts/build-map-layers.mjs
//
// Same projection and path encoding as scripts/build-coastline.mjs: integer
// relative moves in map units × q, drawn with transform="scale(1/q)".
// Glaciers and lakes are lists of paths, one per polygon (outer ring plus
// its holes). Large glaciers are mapped as many neighbouring outlet
// glaciers that overlap a little; one path per polygon keeps the overlaps
// from cutting holes under an even-odd fill.
// Data © OpenStreetMap contributors (ODbL). Credit is in the page footer.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const query = (bbox) => `[out:json][timeout:300];
(
  way["natural"="glacier"](${bbox});
  relation["natural"="glacier"](${bbox});
  way["natural"="water"]["water"~"^(lake|reservoir)$"](${bbox});
  relation["natural"="water"]["water"~"^(lake|reservoir)$"](${bbox});
  way["highway"]["name"~"^(Kjalvegur|Sprengisandsleið)$"](${bbox});
);
out geom qt;`;
const UA = 'vedurstod-turbo/0.8 (+weather dashboard; map layer build)';
const out = (name) => fileURLToPath(new URL(`../web/public/data/${name}.json`, import.meta.url));

// Same projection as web/panels/iceland-shape.ts. Keep in step.
const LON0 = -24.75;
const LAT1 = 66.65;
const COS = 0.42261826174069944;
const K = 204.86593793528124;
const project = (lat, lon) => [(lon - LON0) * COS * K, (LAT1 - lat) * K];

const KM2 = 1 / 0.2865; // map units² per km²

// tol: Douglas-Peucker tolerance in map units (1 unit ≈ 540 m), about half a
// screen pixel on that view. Areas in km².
const LEVELS = [
  { name: 'highland', bbox: '63.6,-21.4,65.7,-14.6', q: 20, tol: 0.12, glacier: 3, lake: 4, hole: 0.3 },
  { name: 'country', bbox: '63.2,-24.6,66.6,-13.4', q: 10, tol: 0.35, glacier: 5, lake: 8, hole: 2 },
];

let Q;
let TOL;
let MIN_HOLE;
let elements = [];

const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** Join open lines end to end (reversing where needed) into closed rings. */
function joinRings(lines) {
  const left = lines.filter((l) => l.length > 1).map((l) => [...l]);
  const rings = [];
  while (left.length) {
    let ring = left.pop();
    let grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < left.length; i++) {
        const l = left[i];
        if (key(l[0]) === end) ring = ring.concat(l.slice(1));
        else if (key(l[l.length - 1]) === end) ring = ring.concat([...l].reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

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

function simplifyRing(r) {
  const h = Math.floor(r.length / 2);
  return [...simplify(r.slice(0, h + 1), TOL).slice(0, -1), ...simplify([...r.slice(h), r[0]], TOL)];
}

function encode(lines, closed) {
  let out = '';
  for (const line of lines) {
    const pts = [];
    for (const [x, y] of line) {
      const p = [Math.round(x * Q), Math.round(y * Q)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    if (closed && pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < (closed ? 3 : 2)) continue;
    const moves = [];
    for (let i = 1; i < pts.length; i++) moves.push(`${pts[i][0] - pts[i - 1][0]} ${pts[i][1] - pts[i - 1][1]}`);
    out += `M${pts[0][0]} ${pts[0][1]}l${moves.join(' ').replace(/ -/g, '-')}${closed ? 'z' : ''}`;
  }
  return out;
}

const projectLine = (geom) => geom.map((g) => project(g.lat, g.lon));

/**
 * Polygons of one kind (glacier or water), each a list of rings (outer
 * rings, then holes): multipolygon relations and closed ways. Ways that
 * belong to a fetched relation are skipped, so no shape is drawn twice.
 */
function polygons(isKind, minArea) {
  const rels = elements.filter((e) => e.type === 'relation' && isKind(e.tags ?? {}));
  const inRelation = new Set(rels.flatMap((r) => r.members.filter((m) => m.type === 'way').map((m) => m.ref)));
  const out = [];
  const clean = (rings) => rings.map(simplifyRing).filter((r) => r.length >= 3);
  for (const r of rels) {
    const outer = joinRings(r.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry));
    const inner = joinRings(r.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry));
    const outerP = outer.map(projectLine).filter((p) => area(p) >= minArea);
    if (!outerP.length) continue;
    out.push(clean([...outerP, ...inner.map(projectLine).filter((p) => area(p) >= MIN_HOLE)]));
  }
  for (const w of elements) {
    if (w.type !== 'way' || inRelation.has(w.id) || !isKind(w.tags ?? {}) || !w.geometry) continue;
    if (key(w.geometry[0]) !== key(w.geometry[w.geometry.length - 1])) continue;
    const p = projectLine(w.geometry);
    if (area(p) >= minArea) out.push(clean([p]));
  }
  return out.filter((rings) => rings.length > 0);
}

for (const level of LEVELS) {
  Q = level.q;
  TOL = level.tol;
  MIN_HOLE = level.hole * KM2;
  console.log(`${level.name}: fetching from Overpass…`);
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query(level.bbox) }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  elements = (await res.json()).elements;

  const glaciers = polygons((t) => t.natural === 'glacier', level.glacier * KM2);
  const lakes = polygons((t) => t.natural === 'water' && /^(lake|reservoir)$/.test(t.water ?? ''), level.lake * KM2);
  const roads = elements
    .filter((e) => e.type === 'way' && e.tags?.highway && /^(Kjalvegur|Sprengisandsleið)$/.test(e.tags.name ?? '') && e.geometry)
    .map((w) => simplify(projectLine(w.geometry), TOL));

  const data = {
    q: Q,
    glaciers: glaciers.map((rings) => encode(rings, true)),
    lakes: lakes.map((rings) => encode(rings, true)),
    roads: encode(roads, false),
  };
  const file = out(level.name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  console.log(
    `${level.name}: glaciers ${glaciers.length} polygons, lakes ${lakes.length} polygons, roads ${roads.length} lines; ` +
      `${(JSON.stringify(data).length / 1024).toFixed(0)} kB → ${file}`,
  );
}
