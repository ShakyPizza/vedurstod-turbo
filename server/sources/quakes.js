import { cached } from '../cache.js';

const TTL = 60 * 1000;
const PAGE_URL = 'https://www.vedur.is/skjalftar-og-eldgos/jardskjalftar/';

// vedur.is decimals use Icelandic comma; convert before parseFloat.
function num(s) {
  if (s === undefined || s === null) return null;
  const n = Number.parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function extractFieldString(block, key) {
  const re = new RegExp(`'${key}'\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  const m = re.exec(block);
  return m ? m[1] : null;
}

// Parse `'t':new Date(2026,4-1,25,12,27,9)` — Iceland is on UTC year-round so
// we treat the components as UTC and emit an ISO string.
function extractDate(block) {
  const m = /'t'\s*:\s*new Date\(\s*(\d+)\s*,\s*(\d+)\s*-\s*1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(
    block,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ts = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return new Date(ts).toISOString();
}

function splitRecords(arrayBody) {
  const out = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === "'") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(arrayBody.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function parsePage(html) {
  const marker = 'VI.quakeInfo';
  const idx = html.indexOf(marker);
  if (idx < 0) return [];
  const lbr = html.indexOf('[', idx);
  if (lbr < 0) return [];
  // Walk to the matching ']' respecting strings.
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = lbr; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === "'") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const records = splitRecords(html.slice(lbr + 1, end));

  return records
    .map((rec, i) => {
      const lat = num(extractFieldString(rec, 'lat'));
      const lon = num(extractFieldString(rec, 'lon'));
      const depth = num(extractFieldString(rec, 'dep'));
      const magnitude = num(extractFieldString(rec, 's'));
      const quality = extractFieldString(rec, 'q');
      const dL = extractFieldString(rec, 'dL');
      const dD = (extractFieldString(rec, 'dD') ?? '').trim();
      const dR = (extractFieldString(rec, 'dR') ?? '').replace(/_/g, ' ').trim();
      const time = extractDate(rec);
      const place = dL && dD && dR ? `${dL} km ${dD} af ${dR}` : dR || null;
      return {
        id: `${time ?? ''}-${i}`,
        lat,
        lon,
        time,
        magnitude,
        depth,
        quality,
        place,
      };
    })
    .filter((q) => q.time !== null);
}

async function load() {
  const res = await fetch(PAGE_URL, {
    headers: { accept: 'text/html', 'user-agent': 'vedurstod-turbo/0.6 (+https://github.com)' },
  });
  if (!res.ok) throw new Error(`quakes ${res.status}`);
  const html = await res.text();
  const quakes = parsePage(html);
  quakes.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return {
    fetchedAt: new Date().toISOString(),
    quakes,
  };
}

export function getQuakes() {
  return cached('quakes', TTL, load);
}
