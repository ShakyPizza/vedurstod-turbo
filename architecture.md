# Veðurstöð Turbo — architecture

A personal weather dashboard for any Veðurstofa Íslands automatic weather station, styled after 1960s–70s industrial control panels. Runs on a Raspberry Pi on a private Tailscale tailnet. Pushes to `main` on GitHub auto-deploy within ~60 s. Default station is **Seltjarnarnes Suðurnes** (`1471`); any station can be selected at runtime from the browser.

## High-level shape

```
GitHub (main)
     │
     │  systemd timer polls every 60 s
     ▼
Raspberry Pi ──────────────────────────────────────────────
  scripts/deploy.sh                                       │
    git fetch → compare HEAD → reset --hard               │
    npm ci (only if lockfile changed)                     │
    npm run build                                         │
    systemctl --user restart vedurstod-turbo              │
                                                          │
  vedurstod-turbo.service  (long-running)                 │
    node server/index.js                                  │
      ├── GET /                     → serves built SPA    │
      ├── GET /api/obs?station=ID   → xmlweather.vedur.is │
      ├── GET /api/forecast?station=ID → xmlweather…      │
      ├── GET /api/warnings?lat=…&lon=… → vidvaranir JSON │
      └── in-memory TTL cache (keyed per station)         │
                                                          │
Reachable only via Tailnet (0.0.0.0:8080, no public DNS)  │
────────────────────────────────────────────────────────────
```

## Stack

- **Server** — Node 20+ (plain ESM, zero runtime framework). Uses `node:http`, the built-in `fetch`, and `fast-xml-parser` for vedur.is XML. One dependency, no build step.
- **Frontend** — Vite + TypeScript, no UI framework. Each panel is a self-contained module implementing a tiny `Panel` contract. SVG is constructed imperatively from the panel code.
- **Moon** — [`suncalc`](https://github.com/mourner/suncalc) for illumination, phase, rise/set. Terminator is an SVG `<path>` of two arcs, not an image.
- **Deployment** — systemd user services + a timer polling git. No reverse proxy, no container, no SSL (Tailscale handles that if you want it).

## Directory layout

```
.
├── server/                         Node server (runtime)
│   ├── index.js                    HTTP server, routing, static file serving
│   ├── cache.js                    TTL + single-flight cache
│   ├── config.js                   default station + query-param resolvers
│   └── sources/
│       ├── vedur.js                shared XML fetch + parse helpers
│       ├── obs.js                  /api/obs loader (10 min TTL, station-keyed)
│       ├── forecast.js             /api/forecast loader (60 min TTL, station-keyed)
│       └── warnings.js             /api/warnings loader (2 min TTL, lat/lon-keyed)
│
├── web/                            Vite source (built to dist/)
│   ├── index.html                  console shell + station dialog
│   ├── main.ts                     panel registry, bootstrap, clock, station wiring
│   ├── station-config.ts           localStorage load/save + default station
│   ├── styles/main.css             brushed-metal + CRT aesthetic
│   └── panels/
│       ├── types.ts                Panel contract + DOM/SVG helpers + fetch helper
│       ├── obs.ts                  VEÐUR NÚNA — analog wind gauge + digital readouts
│       ├── forecast.ts             SPÁ — hourly/3-hourly cells grouped by day
│       ├── warnings.ts             VIÐVARANIR — warning lamps, nearby vs rest of country
│       ├── moon.ts                 TUNGL — SVG orb with true terminator arc
│       └── placeholder.ts          empty panel for unimplemented streams
│
├── systemd/                        unit files to install into ~/.config/systemd/user/
│   ├── vedurstod-turbo.service         long-running server
│   ├── vedurstod-turbo-deploy.service  oneshot deploy
│   └── vedurstod-turbo-deploy.timer    polls origin/main every 60 s
│
├── scripts/
│   └── deploy.sh                   idempotent pull-build-restart script
│
├── dist/                           Vite build output (served by Node; git-ignored)
├── vite.config.ts
├── tsconfig.json
├── package.json
└── architecture.md                 (this file)
```

## Data sources

| Endpoint | Upstream | Cache TTL | Notes |
|---|---|---|---|
| `/api/obs?station=ID` | `xmlweather.vedur.is ?type=obs&ids=ID` | 10 min, per station | Requests `T, F, FX, FG, D, R, RH, P, N, TD, V`. Missing params return `null`. Cache key: `obs:ID`. |
| `/api/forecast?station=ID` | `xmlweather.vedur.is ?type=forec&ids=ID` | 60 min, per station | ~10 days out, hourly then 3-hourly. Icelandic state strings (`Alskýjað`, `Skúrir`, `Rigning`, ...). Cache key: `forecast:ID`. |
| `/api/warnings?lat=…&lon=…` | `https://www.vedur.is/vedur/vidvaranir/` (embedded CAP JSON) | 2 min, per coord | Not a clean API — the page embeds the CAP alert array as JSON inside a JS literal. `warnings.js` extracts it by balanced-brace parsing. Each alert is tagged `coversStation` via point-in-polygon against the caller's lat/lon. Cache key rounds coords to 4 dp. |
| `/api/health` | — | — | Liveness probe. |
| `/api/station-default` | — | — | Returns the server's compiled-in default station (used as a last-resort fallback by the frontend). |

Every data endpoint has safe defaults: omitting the query params is equivalent to requesting the compiled-in default station, so curl-testing `/api/obs` still works.

### vedur.is caveats

- `xmlweather.vedur.is` is the right host. `apis.is` has an expired cert.
- The warnings page comes with entries in both `is-IS` and `en-US` inside each alert's `info` array. We keep only the Icelandic one.
- The warnings JSON block is brittle — if vedur.is changes the page structure it will need a new extractor.
- Decimal separators in obs are Icelandic commas (`"1,5"`). `vedur.js#num` handles that.

## Station configuration

The weather station is a pure client-side concern. There is no config file on the Pi, no environment variable, and no server-side mutable state.

- **Source of truth**: `localStorage['vedurstod:station']`, a JSON blob of `{ id, name, lat, lon }`.
- **Default fallback**: `web/station-config.ts#DEFAULT_STATION` (and `server/config.js#DEFAULT_STATION`, kept in sync) — Seltjarnarnes Suðurnes, station 1471.
- **Editing**: the **STÖÐ** button in the console header opens a native `<dialog>` with an id/name/lat/lon form. Saving persists to localStorage and reloads the page so every panel re-mounts with the new context. The dialog links to [`xmlweather.vedur.is`](https://xmlweather.vedur.is/) so users can look up station ids there.
- **Wiring**: `main.ts#buildContext` constructs a `PanelContext` that carries the station plus an `apiUrl(endpoint)` helper. Every panel that talks to the server goes through `ctx.apiUrl('obs' | 'forecast' | 'warnings')`, which appends `?station=…&lat=…&lon=…`.
- **Server side**: `server/index.js#handleApi` parses the query, and each loader (`getObservation`, `getForecast`, `getWarnings`) accepts the station id / coords as arguments and computes its own cache key. Missing params fall back to `DEFAULT_STATION` via `server/config.js#resolveStationId` / `resolveCoord`.
- **Multi-tenant safety**: the in-memory TTL cache is keyed per station (`obs:1471`, `forecast:1471`, `warnings:64.1542:-22.0270`), so two browser tabs pointing at the same server at different stations don't clobber each other.

The `sunrise / sunset` line in the header and the moon panel's rise/set times are also computed from the current station's coordinates, so switching station visibly changes those too.

### Panel contract

Every panel module exports a factory that returns:

```ts
interface Panel {
  mount(root: HTMLElement, ctx: PanelContext): void
  refresh(): void | Promise<void>
  intervalMs: number   // 0 = static, otherwise polled by main.ts
}
```

`main.ts` mounts each panel into a `<section data-panel="...">` slot. Adding a new stream is three steps:

1. New file `web/panels/<name>.ts` implementing `Panel`.
2. New loader `server/sources/<name>.js` + route in `server/index.js#handleApi`.
3. Register the factory in `main.ts`'s `PANELS` map.

Empty placeholder slots (`tides`, `quakes`, `traffic`) already exist in `index.html` and are wired to `placeholderPanel()` until real data sources land.

## Aesthetic

Stylised CSS-only v1, built to be upgraded to something more skeuomorphic later without touching the data layer. Key choices:

- Three typefaces: `Oswald` for silk-screened panel labels, `VT323` for big CRT-style readouts, `IBM Plex Mono` for small body text.
- Two screen tints: amber for readouts that track a current value, green for forecast/secondary data.
- Status lamps (`.status-lamp`) and warning lamps (`.lamp`) share an off/on/alert visual language: inset shadow when dead, outer glow when live, red pulse when critical.
- The wind gauge is a real compass rose with a clockwise-going red needle and a muted secondary needle for gust delta.
- The moon orb is drawn as: dark disk + one `<path>` representing the lit region. The path is built by `moonLitPath(R, k, phase)`, which composes an outer semicircle and a terminator elliptical arc. Sweep flags depend on waxing/waning and crescent/gibbous; at new moon the two arcs trace the same semicircle in opposite directions so the enclosed area is zero.

## Caching + refresh cadence

- **Server cache** (`server/cache.js`) is a Map-backed TTL cache with single-flight inflight tracking — concurrent requests for the same key share one upstream fetch.
- **Client refresh** is driven by `Panel.intervalMs` in `main.ts`. Current cadence:
  - Obs: 15 min
  - Forecast: 60 min
  - Warnings: 5 min
  - Moon: 60 s (cheap; computed locally)
- Both layers are independent — you can lower client cadence without increasing load on vedur.is.

## Raspberry Pi deployment

Intended target: a Pi 4 / Pi 5 on a private Tailscale tailnet.

### First-time setup

```bash
# as the login user on the Pi (e.g. "pi")
sudo apt update
sudo apt install -y git nodejs npm
node --version   # must be >= 20; if older, install nodesource

# clone into $HOME
cd ~
git clone https://github.com/<you>/vedurstod-turbo.git
cd vedurstod-turbo
npm ci
npm run build

# install user systemd units
mkdir -p ~/.config/systemd/user
cp systemd/vedurstod-turbo.service ~/.config/systemd/user/
cp systemd/vedurstod-turbo-deploy.service ~/.config/systemd/user/
cp systemd/vedurstod-turbo-deploy.timer ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now vedurstod-turbo.service
systemctl --user enable --now vedurstod-turbo-deploy.timer

# so the services keep running when you're logged out
sudo loginctl enable-linger "$USER"
```

Then visit `http://<pi-hostname>.<tailnet>.ts.net:8080` from any device on the tailnet.

### Optional: Tailscale serve (HTTPS via MagicDNS cert)

```bash
tailscale serve --bg --https=443 http://localhost:8080
```

### Auto-deploy loop

`vedurstod-turbo-deploy.timer` fires `vedurstod-turbo-deploy.service` every 60 s, which runs `scripts/deploy.sh`:

1. `git fetch origin main`
2. If `HEAD == origin/main`, exit 0.
3. Otherwise `git reset --hard origin/main`.
4. `npm ci` **only if** `package.json` or `package-lock.json` changed.
5. `npm run build`.
6. `systemctl --user restart vedurstod-turbo.service`.

The timer is short-circuit-friendly: with no new commits, each tick costs one tiny fetch request to GitHub and exits immediately. The working tree is always a verbatim mirror of `origin/main` — local changes on the Pi will be blown away by step 3. Don't edit on the Pi; edit on the laptop, push, wait a minute.

### Why polling and not a webhook

The Pi is Tailnet-only — GitHub can't reach it. A webhook would require either opening a port (no), a Cloudflare Tunnel (extra moving parts), or a GitHub Actions workflow with Tailscale OAuth (setup overhead). A 60 s polling timer with HEAD-comparison short-circuit uses no inbound networking, has no secrets, and already gives deploy latency equal to "next tick after push".

## Future streams

Three empty slots are wired into the layout and `main.ts` panel registry:

- **SJÁVARFÖLL** — tides. Candidate: vedur.is `/hafis/sjavarfoll/reiknud/` or Landhelgisgæslan SjávarFöll tables.
- **SKJÁLFTAR** — earthquakes. Candidate: `hraun.vedur.is/ja/skjalftalisti/`, or the Icelandic Met Office seismic JSON feed.
- **UMFERÐ** — traffic. Candidate: Vegagerðin `umferdin.is` open data.

Each needs a new `server/sources/<name>.js` + `web/panels/<name>.ts` and a registry entry. The `placeholderPanel` they currently use has an empty `refresh()` so there's nothing to unwind.

## Local development

```bash
# terminal 1: API server on :8080
npm run dev:server

# terminal 2: Vite dev server on :5173 with /api proxied to 8080
npm run dev
```

`vite.config.ts` proxies `/api` → `localhost:8080`, so the two behave like the production single-origin setup.

Production build + single-process serve:

```bash
npm run build
npm start   # node server/index.js — serves dist/ and /api together on :8080
```
