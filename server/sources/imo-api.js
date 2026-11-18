// Client for the Icelandic Met Office open API at https://api.vedur.is.
// Docs (Swagger): https://api.vedur.is/ — one OpenAPI spec per sub-API
// (weather, cap, quakes, …). Each sub-API takes an optional
// `x-vi-api-version` header; pinning it keeps the response shape stable.

const API_BASE = 'https://api.vedur.is';
const FETCH_TIMEOUT_MS = 15 * 1000;
const UA = 'vedurstod-turbo/0.8 (+weather dashboard)';

/**
 * GET `${API_BASE}${path}` and parse JSON. Returns `null` for 204 No Content
 * (the CAP API answers 204 when there are no active alerts). Errors carry the
 * upstream status as `statusCode`.
 */
export async function fetchImoJson(path, { params = {}, apiVersion } = {}) {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { accept: 'application/json', 'user-agent': UA };
  if (apiVersion) headers['x-vi-api-version'] = apiVersion;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = new Error(`api.vedur.is ${url.pathname} ${res.status} ${res.statusText}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.json();
}
