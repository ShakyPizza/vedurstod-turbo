import { cached } from '../cache.js';
import { parseVedurTime } from './vedur.js';

const TTL = 30 * 60 * 1000;
const HUGINN_ID = 500;
const XML_BASE = 'https://xmlweather.vedur.is/';

function extractText(raw) {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  const parts = [];
  if (raw['#text'] !== undefined) {
    const t = raw['#text'];
    if (Array.isArray(t)) parts.push(...t.map(String));
    else parts.push(String(t));
  }
  return parts.join('\n\n');
}

async function load() {
  const url = new URL(XML_BASE);
  url.searchParams.set('op_w', 'xml');
  url.searchParams.set('type', 'txt');
  url.searchParams.set('lang', 'is');
  url.searchParams.set('view', 'xml');
  url.searchParams.set('ids', String(HUGINN_ID));

  const res = await fetch(url, {
    headers: { 'user-agent': 'vedurstod-turbo/0.1 (+weather dashboard)' },
  });
  if (!res.ok) throw new Error(`vedur.is ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/);
  const creationMatch = xml.match(/<creation>([\s\S]*?)<\/creation>/);
  const validFromMatch = xml.match(/<valid_from>([\s\S]*?)<\/valid_from>/);
  const validToMatch = xml.match(/<valid_to>([\s\S]*?)<\/valid_to>/);
  const contentMatch = xml.match(/<content>([\s\S]*?)<\/content>/);

  if (!contentMatch) throw new Error('no text forecast content');

  const rawContent = contentMatch[1];
  const paragraphs = rawContent
    .split(/<br\s*\/?>\s*<br\s*\/?>/gi)
    .map((s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    createdAt: parseVedurTime(creationMatch?.[1]),
    validFrom: parseVedurTime(validFromMatch?.[1]),
    validTo: parseVedurTime(validToMatch?.[1]),
    paragraphs,
    fetchedAt: new Date().toISOString(),
  };
}

export function getTextaspa() {
  return cached(`textaspa:${HUGINN_ID}`, TTL, () => load());
}
