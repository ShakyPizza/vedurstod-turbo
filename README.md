# Veðurstöð Turbo

A personal weather console for any Veðurstofa Íslands weather station, styled after 1960s–70s industrial control panels. Runs on a Raspberry Pi on a private Tailscale tailnet. Default station is **Seltjarnarnes Suðurnes** (`1471`) but any automatic station can be picked at runtime from the browser.

## What it shows

- **VEÐUR NÚNA** — current observations from the configured station, on an analog wind compass (main needle for direction + speed, ghost needle for gusts) plus CRT-style readouts for temperature, dew point, humidity, and pressure.
- **SPÁ** — station-specific forecast out to ~10 days, grouped by day, hourly early then 3-hourly.
- **VIÐVARANIR** — active Icelandic Met Office weather warnings rendered as warning lamps. Alerts whose polygons cover the station coordinates appear under "NÁGRENNI STÖÐVAR"; the rest of the country appears below. Click a lamp for full CAP detail.
- **TUNGL** — current moon phase as a real SVG orb with a correct elliptical terminator, phase name in Icelandic, illumination percent, next new/full moon, and rise/set times.
- Empty panels reserved for **SJÁVARFÖLL** (tides), **SKJÁLFTAR** (earthquakes), and **UMFERÐ** (traffic) — ready to wire up.

Labels and weather text are in Icelandic throughout.

## Stack

- **Server** — Node 20+ (zero-framework ESM, one dependency for XML parsing). Proxies and caches `xmlweather.vedur.is` and scrapes the embedded CAP JSON from the vedur.is warnings page. Serves the built frontend on the same port.
- **Frontend** — Vite + TypeScript, no UI framework. Each panel is a self-contained module implementing a tiny `Panel` contract, making new data streams a drop-in addition.
- **Deploy** — systemd user service + a 60 s polling timer that `git pull`s and restarts. Tailnet-only, no inbound ports, no webhooks.

## Choosing a weather station

The station is set in the browser, not in a config file on disk. Click the **STÖÐ** button in the console header to open the station dialog, where you can enter:

- **Stöðvanúmer** — Veðurstofan's numeric station id (used against `xmlweather.vedur.is?ids=…`)
- **Nafn** — display name shown in the header
- **Breiddar- / lengdargráða** — used for warning-polygon lookups, sunrise/sunset, and moon rise/set

Values are persisted in `localStorage` under `vedurstod:station`. Clicking **Sjálfgefið** resets to the built-in default (Seltjarnarnes Suðurnes, `1471`). The server has no per-user state — every API call carries `?station=…&lat=…&lon=…`, and the TTL cache is keyed on those values, so two clients on the same server can display different stations without stepping on each other.

Station numbers and coordinates are published by Veðurstofa Íslands at [`xmlweather.vedur.is`](https://xmlweather.vedur.is/) (the same XML endpoint this app proxies). The dialog links there directly.

## Running locally

```bash
npm ci
npm run dev        # starts both Vite (:5173) and the API server (:8080) together
```

Open `http://localhost:5173`. The `/api` proxy is handled by Vite in dev mode.

Or as a single production process:

```bash
npm run build
npm start
# http://localhost:8080
```

## Deploying with Docker + Traefik

The included `docker-compose.yml` builds a multi-stage image and registers it with Traefik via Docker labels. Intended for deployment on a server already running Traefik.

**First-time setup on the server:**

```bash
git clone <repo> /opt/vedurstod-turbo
cd /opt/vedurstod-turbo
docker compose up -d --build
```

The app will be available at `vedur.benediktorri.is` once Traefik picks up the labels (immediate, no restart needed). Let's Encrypt issues the cert automatically on first request.

**Requirements:**
- An external Docker network named `traefik` must exist (`docker network create traefik` if it doesn't).
- Traefik must be configured with a `letsencrypt` cert resolver and the Docker provider enabled.

## Deploying via GitHub Actions (auto-deploy on push)

A self-hosted GitHub Actions runner on the server handles deploys. On every push to `main`, the workflow SSHes into the server and runs:

```bash
cd /opt/vedurstod-turbo && git pull origin main && docker compose up -d --build vedur
```

**Setup:**

1. Install a self-hosted runner on the server and register it with the repo (`Settings → Actions → Runners`).
2. Clone the repo to `/opt/vedurstod-turbo` on the server.
3. Push to `main` — the workflow in `.github/workflows/deploy.yml` triggers automatically.

No secrets or SSH keys are needed since the runner executes directly on the server.

## Deploying on a Raspberry Pi

See [`architecture.md`](./architecture.md) — it has the full data flow, the panel contract, the caching strategy, the systemd units, and step-by-step first-time setup for the Pi including the auto-deploy loop.

## Adding a new data stream

Three files, no framework plumbing:

1. `server/sources/<name>.js` — fetch + parse + TTL cache.
2. Route in `server/index.js#handleApi`.
3. `web/panels/<name>.ts` — a `Panel` factory registered in `web/main.ts`.

The placeholder panels for tides, earthquakes, and traffic are already wired into the layout; replacing them is just writing the three files above.
