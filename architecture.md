# Veðurstöð Turbo — architecture

Veðurstöð Turbo is a weather dashboard for Icelandic automatic weather stations. The repo contains one Node server, one Vite frontend, and two supported deployment paths: Raspberry Pi + systemd for a Tailnet-only install, and Docker + Traefik on `traeficvm`.

## High-level shape

```text
browser
  -> frontend in web/
  -> fetch /api/*
  -> server/index.js
  -> server/sources/*
  -> upstream vedur.is data
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
│   ├── deploy-pi.sh
│   └── deploy-traefikvm.sh
├── systemd/
├── Dockerfile
└── docker-compose.yml
```

## API surface

| Endpoint | Purpose | Cache |
|---|---|---|
| `/api/obs?station=ID` | current observation data for a station | 10 min |
| `/api/forecast?station=ID&forecastStation=ID` | station forecast from vedur.is | 60 min |
| `/api/warnings?lat=…&lon=…` | active Icelandic weather warnings near a point | 2 min |
| `/api/textaspa` | Icelandic text forecast from Hugin | 30 min |
| `/api/health` | liveness probe | none |

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
- the station dialog includes a dropdown populated from `web/stations.json`
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
- warnings are extracted from an embedded CAP JSON blob using balanced-brace parsing, then filtered to Icelandic entries and matched by polygon
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

### Raspberry Pi / Tailnet

- systemd units live in `systemd/`
- the polling deploy script is `scripts/deploy-pi.sh`
- `vedurstod-turbo-deploy.timer` runs every 60 seconds
- when `origin/main` changes, the deploy script resets to the remote head, optionally runs `npm ci`, builds, and restarts the user service

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
