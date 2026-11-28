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
│       ├── landsspa.js
│       ├── warnings.js
│       └── textaspa.js
│   └── data/landsspa-stations.json
├── web/
│   ├── index.html
│   ├── landid.html
│   ├── main.ts
│   ├── landid/          (the Landsspá page: main, data, map, timebar, detail, coast-lo)
│   ├── public/start.js  (start-page choice, loaded by both pages)
│   ├── public/data/coast-hi.json
│   ├── public/data/highland.json
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
│   ├── build-landsspa-stations.mjs
│   ├── build-coastline.mjs
│   ├── build-highland.mjs
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
| `/api/stations` | all active weather stations, compact, for the name autocomplete (`api.vedur.is/weather/stations?region_id=…`) | 24 h |
| `/api/station-info?id=ID` | station name and coordinates (`api.vedur.is/weather/stations/{id}`) | 24 h |
| `/api/health` | liveness probe | none |
| `/api/landsspa?ids=1,3471,…` | forecasts for the Landsspá stations (fixed list in `server/data/landsspa-stations.json`; `ids` only filters it, empty means the overview stations), one upstream call for all | 30 min (3 min after a failure) |
| `/stodvar` (HTML, not under `/api`) | full list of active weather stations | 24 h |
| `/landid` (HTML) | the Landsspá page (`dist/landid.html`) | none |

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
- typing in the name field suggests stations (`web/station-search.ts`). It loads `/api/stations` once per page and ranks matches by name prefix, then word prefix, then substring. Accents and þ/ð/æ/ö are folded, so `theista` finds Þeistareykir. Curated stations win ties. If the list fails to load, it searches `web/stations.json` only
- typing a station number looks the station up through `/api/station-info`; if that service fails, the typed fields are used as-is
- the id/name/lat/lon fields remain editable, so the dropdown is a convenience rather than the only input path
- every API URL includes station id plus lat/lon, so different browser tabs can target different stations against the same server safely

### Implemented panels

- `obs.ts` renders current observations and the embedded Hugin text forecast
- `forecast.ts` renders the multi-day forecast grid
- `warnings.ts` renders warning lamps and warning detail
- `moon.ts` renders the moon phase locally using `suncalc`
- `placeholder.ts` fills the empty `tides`, `quakes`, and `traffic` slots

## Landsspá page (`/landid`)

A second Vite page (`web/landid.html`, entry `web/landid/main.ts`) with the nationwide station forecast map, in the spirit of the old vedur.is "Staðaspár" map.

- **Stations.** `server/data/landsspa-stations.json` holds every station the page can show. `scripts/build-landsspa-stations.mjs` builds it: the 25 stations of the old vedur.is overview map (in label-placement order), the 11 capital-area stations of the KORT panel, and every other active Veðurstofan station that xmlweather has a forecast for. The server and the page both read this file. Re-run the script to refresh it.
- **Regions.** Seven views, defined in `web/landid/data.ts`: the whole country (overview stations only), the capital area (its own coastline and projection from `metro-shape.ts`), and five bounding boxes (Suðurnes, SV, NV, NA, SA) plus the highlands. Zoomed views show every catalogue station in the box; labels that would overlap are hidden.
- **Data.** One `/api/landsspa` call per region. The server fetches all catalogue stations from xmlweather in one cached call (with `params=F;D;T;W;R`) and returns the requested subset on one shared time axis. Weather words are sent once in a `weather` list and referenced by index.
- **Coastline.** OpenStreetMap `natural=coastline`, built by `scripts/build-coastline.mjs` in the projection of `iceland-shape.ts`. Two detail levels: `web/landid/coast-lo.ts` (bundled, whole country) and `web/public/data/coast-hi.json` (about 200 kB, 77 kB gzipped, fetched only when a zoomed region opens). Paths are integer relative moves, drawn with `scale(1/q)`.
- **Hálendið layers.** The highland view also draws glaciers, large lakes and reservoirs, and the two crossings (Kjalvegur and Sprengisandsleið) from `web/public/data/highland.json` (about 58 kB, fetched only for that view), built by `scripts/build-highland.mjs` from OpenStreetMap. Landmark names (glaciers, lakes, peaks, Landmannalaugar, the crossings) are listed in `HIGHLAND_LABELS` in `web/landid/data.ts`. They are placed after the station readouts and hidden where they would cover one.
- **Layout.** On screens 1100 px or wider the Fjarriti (hour-by-hour list) sits under the region buttons; on narrower screens the regions go above the map and the Fjarriti moves under the station panel, in up to three columns.
- **Same parts as the dashboard.** The page loads `main.css` and `version-switch.css` and uses the dashboard's markup for the header (nameplate, sundial, station, clock), the tab strip (Landsspá tab, the saved station tabs as links back to `/`), panel shells and titles, status lamps and the footer. `landid.css` only adds the page's own parts and the light theme. Do not restyle the shared parts there beyond the light-theme overrides.
- **Theme.** Light (taupe) by default, dark on the switch in the tab strip. Dark is the dashboard's look unchanged. Light sets `--bg-h/s/l` (the dashboard derives every metal shade from these) and a few label and key colours; screens and panel titles stay dark glass in both themes. Stored in `localStorage['vedurstod:landid-theme']`; an inline script applies it before the page draws.
- **Start page.** `web/public/start.js` runs first on both pages. `localStorage['vedurstod:start']` (`landid` or `stod`) is set once: new visitors get `landid`, anyone with saved tabs or a saved station gets `stod`. The switch on the Landsspá page changes it. Only the first page load of a tab's session follows it (`sessionStorage['vedurstod:entered']`), so links between the pages do not bounce.
- **Mínar stöðvar button.** Adds the selected station as a dashboard tab (or activates it if present; replaces the active tab when all 6 are used) and opens `/`.

## Non-obvious details

- vedur.is observation decimals use Icelandic commas; `server/sources/vedur.js` normalizes them before parsing
- the xmlweather forecast only includes precipitation (`R`, mm since the previous step) when `params` asks for it; `forecast.js` and `landsspa.js` request `F;D;T;W;R`
- the server gzips JSON and text responses of 1 kB or more when the client accepts gzip
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
