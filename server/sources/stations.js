import { cached } from '../cache.js';

const STODVAR_INDEX = 'https://www.vedur.is/vedur/stodvar/';
const CATALOG_TTL = 24 * 60 * 60 * 1000;
const STATION_TTL = 24 * 60 * 60 * 1000;

const UA = 'vedurstod-turbo/0.1 (+weather dashboard)';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} ${res.status} ${res.statusText}`);
  return res.text();
}

// id → { name, slug } parsed from the master /vedur/stodvar/ list.
async function loadCatalog() {
  const html = await fetchHtml(STODVAR_INDEX);
  const catalog = new Map();
  // Each row pairs a name cell with an "Uppl." anchor that has id="i<NNN>" and href="?s=<slug>".
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(rowRe)) {
    const row = m[1];
    const nameMatch = row.match(/<td class="name">([^<]+)<\/td>/);
    const slugMatch = row.match(/<a[^>]+id="i(\d+)"[^>]+href="[^"]*\?s=([a-z0-9_-]+)"/i);
    if (!nameMatch || !slugMatch) continue;
    const id = Number(slugMatch[1]);
    if (!Number.isFinite(id)) continue;
    catalog.set(id, {
      name: nameMatch[1].trim(),
      slug: slugMatch[2],
    });
  }
  if (catalog.size === 0) throw new Error('failed to parse station catalog');
  return catalog;
}

function getCatalog() {
  return cached('stations:catalog', CATALOG_TTL, loadCatalog);
}

// Parse "65°49.259', 17°20.675' (65,821, 17,3446)" → { lat: 65.821, lon: -17.3446 }
// Iceland is in western hemisphere — the decimal longitude on the page is unsigned, so we negate.
function parseCoords(html) {
  const m = html.match(/<td>Sta[ðd]setning<\/td>\s*<td>[^<]*?\(([^)]+)\)/i);
  if (!m) return null;
  const decimals = m[1].split(',').map((s) => s.trim());
  // The string uses Icelandic decimal commas, so "65,821, 17,3446" splits into 4 parts on `,`.
  // Re-join into two numbers: [lat-int, lat-frac, lon-int, lon-frac].
  if (decimals.length !== 4) return null;
  const lat = Number(`${decimals[0]}.${decimals[1]}`);
  const lonAbs = Number(`${decimals[2]}.${decimals[3]}`);
  if (!Number.isFinite(lat) || !Number.isFinite(lonAbs)) return null;
  return { lat, lon: -lonAbs };
}

async function loadStation(id) {
  const catalog = await getCatalog();
  const entry = catalog.get(id);
  if (!entry) {
    const err = new Error(`station ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const detailUrl = `${STODVAR_INDEX}?s=${encodeURIComponent(entry.slug)}`;
  const html = await fetchHtml(detailUrl);
  const coords = parseCoords(html);
  if (!coords) {
    const err = new Error(`coords missing for station ${id}`);
    err.statusCode = 502;
    throw err;
  }
  return { id, name: entry.name, lat: coords.lat, lon: coords.lon };
}

export function getStationInfo(id) {
  return cached(`station-info:${id}`, STATION_TTL, () => loadStation(id));
}
