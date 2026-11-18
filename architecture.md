# Veðurstöð Turbo — architecture

Veðurstöð Turbo is a weather dashboard for Icelandic automatic weather stations. The repo contains one Node server, one Vite frontend, and one supported deployment path: Docker + Traefik on `traeficvm`.

## High-level shape

```text
browser
  -> frontend in web/
  -> fetch /api/*
  -> server/index.js
  -> server/sources/*
  -> upstream xmlweather.vedur.is (obs, forecast, text)
     and api.vedur.is (CAP warnings, quakes, station metadata)
```

- `server/` is a plain Node ESM HTTP server that serves both the built SPA and the API.
- `web/` is a Vite + TypeScript frontend with no UI framework.
- each panel owns its own fetch and render logic
- server-side caching is TTL-based with single-flight deduplication

## Runtime structure

```text
.
├── server/
│   ├── index.js
│   ├── cache.js
│   ├── config.js
│   └── sources/
│       ├── vedur.js
│       ├── obs.js
│       ├── forecast.js
│       ├── warnings.js
│       └── textaspa.js
├── web/
│   ├── index.html
│   ├── main.ts
│   ├── station-config.ts
│   ├── stations.json
│   ├── styles/main.css
│   └── panels/
│       ├── types.ts
│       ├── obs.ts
│       ├── forecast.ts
│       ├── warnings.ts
│       ├── moon.ts
│       └── placeholder.ts
├── scripts/
│   └── deploy-traefikvm.sh
├── Dockerfile
└── docker-compose.yml
```

## API surface

| Endpoint | Purpose | Cache |
|---|---|---|
| `/api/obs?station=ID` | current observation data for a station | 10 min |
| `/api/obs-multi?ids=1;990;…` | temperature and wind for the map stations (fixed server-side list; `ids` only filters it), one upstream call for all | 10 min (2 min after a failure) |
| `/api/forecast?station=ID&forecastStation=ID` | station forecast from vedur.is | 60 min |
| `/api/warnings?lat=…&lon=…` | active Icelandic weather warnings near a point (`api.vedur.is/cap`) | 2 min (one upstream call shared by all points) |
| `/api/textaspa` | Icelandic text forecast from Hugin | 30 min |
| `/api/quakes` | earthquakes from the last 48 h in and around Iceland (`api.vedur.is/quakes`) | 1 min |
| `/api/station-info?id=ID` | station name and coordinates (`api.vedur.is/weather/stations/{id}`) | 24 h |
| `/api/health` | liveness probe | none |
| `/stodvar` (HTML, not under `/api`) | full list of active weather stations | 24 h |

Notes:

- query params are optional; the server falls back to the compiled-in default station and coordinates
- forecast requests can use `forecastStation` separately from `station`
- warnings are keyed by coordinates because the backend does point-in-polygon matching

## Frontend behavior

### Panel contract

Each panel module returns:

```ts
interface Panel {
  mount(root: HTMLElement, ctx: PanelContext): void
  refresh(): void | Promise<void>
  intervalMs: number
}
```

`web/main.ts` mounts the panel into each `[data-panel]` slot, calls `refresh()`, and sets up polling when `intervalMs > 0`.

### Station selection

- the source of truth is `localStorage['vedurstod:station']`
- the default station is defined in both `web/station-config.ts` and `server/config.js`
- the station dialog includes a dropdown populated from `web/stations.json`: 38 hand-picked main and capital-area stations in a deliberate order (keep it). To change the list, edit `CURATED` in `scripts/build-stations.mjs` and run it; it only takes coordinates from the IMO Weather API
- the dialog links to `/stodvar`, a server-rendered page (`server/pages/stodvar.js`) that lists every active weather station with its number, region and a link to its vedur.is page. The new vedur.is has no such list. Vite proxies `/stodvar` to the backend in dev
- typing a station number looks the station up through `/api/station-info`; if that service fails, the typed fields are used as-is
- the id/name/lat/lon fields remain editable, so the dropdown is a convenience rather than the only input path
- every API URL includes station id plus lat/lon, so different browser tabs can target different stations against the same server safely

### Implemented panels

- `obs.ts` renders current observations and the embedded Hugin text forecast
- `forecast.ts` renders the multi-day forecast grid
- `warnings.ts` renders warning lamps and warning detail
- `moon.ts` renders the moon phase locally using `suncalc`
- `placeholder.ts` fills the empty `tides`, `quakes`, and `traffic` slots

## Non-obvious details

- vedur.is observation decimals use Icelandic commas; `server/sources/vedur.js` normalizes them before parsing
- wind directions are Icelandic 16-point cardinals, not degrees
- warnings come from the CAP API (`/cap/v1/capbroker/active/detailed/all`, 204 when nothing is active), are filtered to category `Met`, and are matched to the station by point-in-polygon
- the `api.vedur.is` clients pin an `x-vi-api-version` header so a new API version cannot change the response shape under us
- the old www.vedur.is pages (`/vedur/stodvar/`, `/vedur/vidvaranir/`, `/skjalftar-og-eldgos/jardskjalftar/`) were removed in the late-2026 site rebuild; do not scrape the new Next.js site
- the moon is drawn as SVG geometry, not an image sprite

## Local development

```bash
npm ci
npm run dev
```

`npm run dev` starts both Vite on `:5173` and the Node server on `:8080`. The Vite dev server proxies `/api` to the backend.

If you only want the backend process:

```bash
npm run dev:server
```

Production-style local run:

```bash
npm run build
npm start
```

## Deployment

### TraefikVM / Docker

- `Dockerfile` builds the frontend and runtime image
- `docker-compose.yml` contains the Traefik-oriented service definition
- the server-side deploy helper is `scripts/deploy-traefikvm.sh`
- `.github/workflows/deploy.yml` triggers that script on pushes to `main` using a self-hosted runner

## Adding a new stream

To add tides, earthquakes, traffic, or another source:

1. add `server/sources/<name>.js`
2. add a route in `server/index.js`
3. add `web/panels/<name>.ts`
4. register it in `web/main.ts`
