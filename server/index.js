import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getObservation } from './sources/obs.js';
import { getForecast } from './sources/forecast.js';
import { getWarnings } from './sources/warnings.js';
import { getTextaspa } from './sources/textaspa.js';
import { getQuakes } from './sources/quakes.js';
import { DEFAULT_STATION, resolveCoord, resolveStationId } from './config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function sendStatic(res, urlPath) {
  const safePath = normalize(urlPath).replace(/^([/\\])+/, '');
  if (safePath.includes('..' + sep) || safePath.startsWith('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let filePath = join(DIST_DIR, safePath || 'index.html');
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(DIST_DIR, 'index.html');
  }
  try {
    const buf = await readFile(filePath);
    const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': mime,
      'content-length': buf.length,
      'cache-control': filePath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=3600',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

async function handleApi(req, res, pathname, query) {
  try {
    const stationId = resolveStationId(query.get('station'));
    const forecastStationId = resolveStationId(query.get('forecastStation') ?? query.get('station'));
    const lat = resolveCoord(query.get('lat'), DEFAULT_STATION.lat);
    const lon = resolveCoord(query.get('lon'), DEFAULT_STATION.lon);
    switch (pathname) {
      case '/api/obs':
        return sendJson(res, 200, await getObservation(stationId));
      case '/api/forecast':
        return sendJson(res, 200, await getForecast(forecastStationId));
      case '/api/warnings':
        return sendJson(res, 200, await getWarnings(lat, lon));
      case '/api/textaspa':
        return sendJson(res, 200, await getTextaspa());
      case '/api/quakes':
        return sendJson(res, 200, await getQuakes());
      case '/api/health':
        return sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
      default:
        return sendJson(res, 404, { error: 'unknown endpoint' });
    }
  } catch (err) {
    console.error(`[api] ${pathname} failed`, err);
    sendJson(res, 502, {
      error: 'upstream',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url.pathname, url.searchParams);
    return;
  }
  await sendStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[vedurstod-turbo] listening on http://${HOST}:${PORT}`);
  console.log(`[vedurstod-turbo] serving static from ${DIST_DIR}`);
});
