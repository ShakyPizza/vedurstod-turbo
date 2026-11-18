import { cached } from '../cache.js';
import { DEFAULT_STATION } from '../config.js';
import { fetchImoJson } from './imo-api.js';

const TTL = 2 * 60 * 1000;
const API_VERSION = '2026-04-14';

// Active CAP alerts from the IMO CAP API. Replaces the old scrape of
// www.vedur.is/vedur/vidvaranir/, which the new vedur.is site removed.
// The API answers 204 (→ null) when nothing is active.
const ACTIVE_URL = '/cap/v1/capbroker/active/detailed/all';

// CAP polygons are "lat,lon lat,lon …".
function parsePolygon(raw) {
  if (!raw) return [];
  return String(raw)
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lat, lon] = pair.split(',').map(Number);
      return [lat, lon];
    })
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

function pointInPolygon(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const hit =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function first(map, key) {
  const v = map?.[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function areaNames(geocode) {
  if (!geocode || typeof geocode !== 'object') return [];
  return [...new Set(Object.values(geocode).flat().filter(Boolean).map(String))];
}

function isWeather(alert) {
  const cats = Array.isArray(alert.category) ? alert.category : [alert.category];
  return cats.some((c) => String(c ?? '').toLowerCase() === 'met');
}

// Fetch every active alert once; per-station filtering happens in getWarnings.
async function loadActive() {
  const data = await fetchImoJson(ACTIVE_URL, { apiVersion: API_VERSION });
  const alerts = Array.isArray(data) ? data : [];
  return {
    fetchedAt: new Date().toISOString(),
    alerts: alerts
      .filter((a) => isWeather(a) && String(a.msgtype ?? '').toLowerCase() !== 'cancel')
      .map((a) => ({
        id: a.identifier,
        msgType: a.msgtype ?? null,
        sent: a.sent ?? null,
        onset: a.onset ?? null,
        expires: a.expires ?? null,
        severity: a.severity ?? null,
        certainty: a.certainty ?? null,
        urgency: a.urgency ?? null,
        color: first(a.parameter, 'Color'),
        type: first(a.eventcode, 'alertType'),
        event: a.event_is ?? null,
        headline: a.headline_is ?? null,
        description: a.description_is ?? null,
        areas: areaNames(a.geocode_is),
        polygons: (Array.isArray(a.polygon) ? a.polygon : [a.polygon]).filter(Boolean).map(parsePolygon),
      })),
  };
}

export async function getWarnings(lat = DEFAULT_STATION.lat, lon = DEFAULT_STATION.lon) {
  const { fetchedAt, alerts } = await cached('warnings:active', TTL, loadActive);
  const now = Date.now();
  const shaped = alerts
    .filter((a) => !a.expires || new Date(a.expires).getTime() >= now)
    .map(({ polygons, ...rest }) => ({
      ...rest,
      coversStation: polygons.some((ring) => pointInPolygon(lat, lon, ring)),
    }));

  shaped.sort((a, b) => {
    if (a.coversStation !== b.coversStation) return a.coversStation ? -1 : 1;
    return String(a.onset ?? '').localeCompare(String(b.onset ?? ''));
  });

  const updatedAt = alerts.reduce((max, a) => (a.sent && a.sent > max ? a.sent : max), '') || null;

  return {
    fetchedAt,
    updatedAt,
    nearby: shaped.filter((a) => a.coversStation),
    other: shaped.filter((a) => !a.coversStation),
    raw: alerts.length,
  };
}
