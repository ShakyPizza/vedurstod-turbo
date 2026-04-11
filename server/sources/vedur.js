import { XMLParser } from 'fast-xml-parser';

export const STATION_ID = 1471;
export const STATION_NAME = 'Seltjarnarnes Suðurnes';

const XML_BASE = 'https://xmlweather.vedur.is/';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'forecast' || name === 'station',
});

export async function fetchXml(params) {
  const url = new URL(XML_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'user-agent': 'vedurstod-turbo/0.1 (+tailnet personal dashboard)' },
  });
  if (!res.ok) throw new Error(`vedur.is ${res.status} ${res.statusText}`);
  const text = await res.text();
  return parser.parse(text);
}

export function num(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function parseVedurTime(raw) {
  if (!raw) return null;
  const iso = String(raw).replace(' ', 'T') + '+00:00';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}
