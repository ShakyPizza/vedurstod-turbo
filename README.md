# Veðurstöð Turbo

A personal weather console for **Seltjarnarnes Suðurnes** (Veðurstofa Íslands station `1471`), styled after 1960s–70s industrial control panels. Runs on a Raspberry Pi on a private Tailscale tailnet.

## What it shows

- **VEÐUR NÚNA** — current observations from station 1471, on an analog wind compass (main needle for direction + speed, ghost needle for gusts) plus CRT-style readouts for temperature, dew point, humidity, and pressure.
- **SPÁ** — station-specific forecast out to ~10 days, grouped by day, hourly early then 3-hourly.
- **VIÐVARANIR** — active Icelandic Met Office weather warnings rendered as warning lamps. Alerts whose polygons cover the station coordinates appear under "NÁGRENNI STÖÐVAR"; the rest of the country appears below. Click a lamp for full CAP detail.
- **TUNGL** — current moon phase as a real SVG orb with a correct elliptical terminator, phase name in Icelandic, illumination percent, next new/full moon, and rise/set times.
- Empty panels reserved for **SJÁVARFÖLL** (tides), **SKJÁLFTAR** (earthquakes), and **UMFERÐ** (traffic) — ready to wire up.

Labels and weather text are in Icelandic throughout.

## Stack

- **Server** — Node 20+ (zero-framework ESM, one dependency for XML parsing). Proxies and caches `xmlweather.vedur.is` and scrapes the embedded CAP JSON from the vedur.is warnings page. Serves the built frontend on the same port.
- **Frontend** — Vite + TypeScript, no UI framework. Each panel is a self-contained module implementing a tiny `Panel` contract, making new data streams a drop-in addition.
- **Deploy** — systemd user service + a 60 s polling timer that `git pull`s and restarts. Tailnet-only, no inbound ports, no webhooks.

## Running locally

```bash
npm ci

# terminal 1 — API on :8080
npm run dev:server

# terminal 2 — Vite on :5173 with /api proxied to :8080
npm run dev
```

Or as a single production process:

```bash
npm run build
npm start
# http://localhost:8080
```

## Deploying on a Raspberry Pi

See [`architecture.md`](./architecture.md) — it has the full data flow, the panel contract, the caching strategy, the systemd units, and step-by-step first-time setup for the Pi including the auto-deploy loop.

## Adding a new data stream

Three files, no framework plumbing:

1. `server/sources/<name>.js` — fetch + parse + TTL cache.
2. Route in `server/index.js#handleApi`.
3. `web/panels/<name>.ts` — a `Panel` factory registered in `web/main.ts`.

The placeholder panels for tides, earthquakes, and traffic are already wired into the layout; replacing them is just writing the three files above.
