import { cached } from '../cache.js';

const TTL = 2 * 60 * 1000;
const WARNINGS_URL = 'https://www.vedur.is/vedur/vidvaranir/';

export const STATION_LAT = 64.1542;
export const STATION_LON = -22.0270;

function extractDataBlock(html) {
  const needle = "'data':";
  const i = html.indexOf(needle);
  if (i < 0) return null;
  let start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let k = start; k < html.length; k++) {
    const ch = html[k];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, k + 1);
    }
  }
  return null;
}

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

function pickInfo(alert) {
  if (!Array.isArray(alert?.info)) return null;
  return (
    alert.info.find((x) => x.language === 'is-IS') ??
    alert.info[0] ??
    null
  );
}

function pickParam(info, name) {
  const arr = Array.isArray(info?.parameter) ? info.parameter : [];
  const hit = arr.find((p) => p.valueName === name);
  return hit ? hit.value : null;
}

function pickEventCode(info, name) {
  const arr = Array.isArray(info?.eventCode) ? info.eventCode : [];
  const hit = arr.find((p) => p.valueName === name);
  return hit ? hit.value : null;
}

async function load() {
  const res = await fetch(WARNINGS_URL, {
    headers: { 'user-agent': 'vedurstod-turbo/0.1 (+tailnet personal dashboard)' },
  });
  if (!res.ok) throw new Error(`vedur.is warnings ${res.status}`);
  const html = await res.text();
  const block = extractDataBlock(html);

  const fetchedAt = new Date().toISOString();
  if (!block) {
    return { fetchedAt, updatedAt: null, nearby: [], other: [], raw: 0 };
  }

  let data;
  try {
    data = JSON.parse(block);
  } catch (err) {
    throw new Error('failed to parse warnings JSON: ' + err.message);
  }

  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];

  const now = Date.now();
  const shaped = [];

  for (const alert of alerts) {
    const info = pickInfo(alert);
    if (!info) continue;
    const expires = info.expires ? new Date(info.expires) : null;
    if (expires && expires.getTime() < now) continue;

    const areas = (Array.isArray(info.area) ? info.area : []).map((a) => {
      const polygons = (Array.isArray(a.polygon) ? a.polygon : [a.polygon])
        .filter(Boolean)
        .map(parsePolygon);
      return {
        description: a.areaDesc ?? null,
        polygons,
      };
    });

    const covers = areas.some((a) =>
      a.polygons.some((ring) => pointInPolygon(STATION_LAT, STATION_LON, ring)),
    );

    shaped.push({
      id: alert.identifier,
      msgType: alert.msgType ?? null,
      sent: alert.sent ?? null,
      onset: info.onset ?? null,
      expires: info.expires ?? null,
      severity: info.severity ?? null,
      certainty: info.certainty ?? null,
      urgency: info.urgency ?? null,
      color: pickParam(info, 'Color'),
      type: pickEventCode(info, 'alertType'),
      event: info.event ?? null,
      headline: info.headline ?? null,
      description: info.description ?? null,
      areas: areas.map((a) => a.description).filter(Boolean),
      coversStation: covers,
    });
  }

  shaped.sort((a, b) => {
    if (a.coversStation !== b.coversStation) return a.coversStation ? -1 : 1;
    return String(a.onset ?? '').localeCompare(String(b.onset ?? ''));
  });

  return {
    fetchedAt,
    updatedAt: data.updateTS ?? null,
    nearby: shaped.filter((a) => a.coversStation),
    other: shaped.filter((a) => !a.coversStation),
    raw: alerts.length,
  };
}

export function getWarnings() {
  return cached('warnings', TTL, load);
}
