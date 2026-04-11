# Veðurstöð Turbo — architecture

A personal weather dashboard for **Seltjarnarnes Suðurnes** (Veðurstofa Íslands station **1471**), styled after 1960s–70s industrial control panels. Runs on a Raspberry Pi on a private Tailscale tailnet. Pushes to `main` on GitHub auto-deploy within ~60 s.

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
      ├── GET /            → serves built SPA (dist/)     │
      ├── GET /api/obs     → xmlweather.vedur.is (obs)    │
      ├── GET /api/forecast→ xmlweather.vedur.is (forec)  │
      ├── GET /api/warnings→ vedur.is vidvaranir JSON     │
      └── in-memory TTL cache                             │
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
│   └── sources/
│       ├── vedur.js                shared XML fetch + parse helpers + station constants
│       ├── obs.js                  /api/obs loader (10 min TTL)
│       ├── forecast.js             /api/forecast loader (60 min TTL)
│       └── warnings.js             /api/warnings loader (2 min TTL)
│
├── web/                            Vite source (built to dist/)
│   ├── index.html                  console shell — panels mount into data-panel slots
│   ├── main.ts                     panel registry, bootstrap, clock
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
| `/api/obs` | `xmlweather.vedur.is ?type=obs&ids=1471` | 10 min | Station 1471 = Seltjarnarnes Suðurnes. Reports `T, F, FX, FG, D, RH, P, TD`. No `R, N, V` — those stay `null`. |
| `/api/forecast` | `xmlweather.vedur.is ?type=forec&ids=1471` | 60 min | ~10 days out, hourly then 3-hourly. Icelandic state strings (`Alskýjað`, `Skúrir`, `Rigning`, ...). |
| `/api/warnings` | `https://www.vedur.is/vedur/vidvaranir/` (embedded CAP JSON) | 2 min | Not a clean API — the page embeds the CAP alert array as JSON inside a JS literal. `warnings.js` extracts it by balanced-brace parsing. Each alert is tagged `coversStation` via point-in-polygon against station coords. |
| `/api/health` | — | — | Liveness probe. |

### vedur.is caveats

- `xmlweather.vedur.is` is the right host. `apis.is` has an expired cert.
- The warnings page comes with entries in both `is-IS` and `en-US` inside each alert's `info` array. We keep only the Icelandic one.
- The warnings JSON block is brittle — if vedur.is changes the page structure it will need a new extractor.
- Decimal separators in obs are Icelandic commas (`"1,5"`). `vedur.js#num` handles that.

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
