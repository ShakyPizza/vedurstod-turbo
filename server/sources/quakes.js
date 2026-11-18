import { cached } from '../cache.js';
import { fetchImoJson } from './imo-api.js';

const TTL = 60 * 1000;
const API_VERSION = '2026-08-06';
const WINDOW_MS = 48 * 60 * 60 * 1000;

// Earthquake catalogue from the IMO Quakes API (`/quakes/events`, GeoJSON).
// Replaces the old scrape of www.vedur.is/skjalftar-og-eldgos/jardskjalftar/,
// which the new vedur.is site removed.
const EVENTS_URL = '/quakes/events';

// Iceland and its near offshore zones (Reykjanes Ridge, Tjörnes Fracture
// Zone, Kolbeinsey). The API default covers the whole North Atlantic.
const ICELAND_POLYGON = 'POLYGON((-26 62.5, -12 62.5, -12 68, -26 68, -26 62.5))';

// Reviewed events that a seismologist marked as not real quakes.
const DROP_TYPES = new Set(['not existing', 'explosion', 'outside of network interest']);

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function load() {
  const start = new Date(Date.now() - WINDOW_MS).toISOString().slice(0, 19);
  const data = await fetchImoJson(EVENTS_URL, {
    params: { start_time: start, polygon: ICELAND_POLYGON, format: 'json' },
    apiVersion: API_VERSION,
  });
  const features = Array.isArray(data?.features) ? data.features : [];

  const quakes = features
    .filter((f) => !DROP_TYPES.has(String(f?.properties?.type ?? '').toLowerCase()))
    .map((f) => {
      const p = f.properties ?? {};
      const [lon, lat] = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : [];
      const t = p.time ? new Date(p.time) : null;
      const time = t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
      return {
        id: String(p.event_id ?? `${time ?? ''}-${lat ?? ''}-${lon ?? ''}`),
        lat: finite(lat),
        lon: finite(lon),
        time,
        magnitude: finite(p.magnitude),
        depth: finite(p.depth),
        quality: p.evaluation_mode === 'manual' ? 'yfirfarinn' : 'sjálfvirkur',
        place: p.region ? String(p.region) : null,
      };
    })
    .filter((q) => q.time !== null);

  quakes.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return { fetchedAt: new Date().toISOString(), quakes };
}

export function getQuakes() {
  return cached('quakes', TTL, load, { failTtlMs: 30 * 1000 });
}
