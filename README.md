# Veðurstöð Turbo

A weather console for Icelandic automatic weather stations, built to look like a 1960s–70s industrial control panel. Version 1.0 is a phosphor console: amber and green phosphor outlines, engraved Routed Gothic lettering, a Bakelite cabinet and pixel-font readouts.

The default station is **Seltjarnarnes Suðurnes** (`1471`). You can pick any station from the browser. All labels and weather text are in Icelandic. Data comes from [Veðurstofa Íslands](https://www.vedur.is).

## Panels

| Panel | Shows |
|---|---|
| **VEÐURATHUGUN** | Current observations: an analog wind dial (main needle for direction and speed, ghost needle for gusts) and readouts for temperature, dew point, humidity and pressure. |
| **SPÁ** | Station forecast for about 10 days, grouped by day. Hourly at first, then every 3 hours. |
| **HUGLEIÐINGAR VEÐURFRÆÐINGS** | The latest text forecast from the duty meteorologist. |
| **VIÐVARANIR** | Active weather warnings as lamps, with Veðurstofan's own Icelandic event names and severity. Warnings that cover the station are listed first. Click a lamp for the full CAP detail. |
| **KORT** | Two maps side by side: Iceland (15 towns, 3 highland stations) and HÖFUÐBORGARSVÆÐI (12 capital-area stations). Each station shows temperature and a wind arrow. Lamp colour shows data age: green under 3 hours, amber older, dim for no data. |
| **SKJÁLFTAR** | Recent earthquakes, with the largest quake of the last 48 hours. New quakes blink. |
| **TUNGL** | Moon phase as an SVG orb with a true terminator, illumination, next new and full moon, and rise and set times. |
| **SJÁVARFÖLL** | Next high and low tides. This is an astronomical estimate from the moon's transit (about ±15–30 min), because Veðurstofan has no tide API. |
| **UMFERÐ** | Placeholder. Not connected yet. |

The header has a **sundial**: a compass seen from above. A lit sector shows today's sun path from sunrise to sunset, and the gnomon's shadow falls opposite the sun. It handles midnight sun and polar night.

## Using the console

- **Stations and tabs.** Click **STÖÐ** in the header to set the station. Pick one of the 38 main and capital-area stations in the list (`web/stations.json`, grouped by forecast region), or type any station number from the full list at `/stodvar`; the name and coordinates fill in automatically. Use **+** in the tab strip to add up to 6 station tabs.
- **Presets.** Export your tabs to a `.json` file and import them on another device with the tab-strip buttons.
- **Layout.** Click the lock in the tab strip to unlock the layout. Then drag panels to reorder them, resize them from the corner, or minimise them. The reset button restores the default layout.
- **Version switch.** Click the version tag in the footer (`v1.0`) to open a rotary switch. Turn it to `0.8` to get the previous skin. Only the look changes; data and layout stay the same.

All settings are kept in the browser's `localStorage`. The server has no per-user state. Every API call carries the station id and coordinates, and the cache is keyed on them, so different clients can show different stations.

## Stack

- **Server:** Node 20+, plain ESM, no framework. It proxies and caches `xmlweather.vedur.is` (observations, forecasts, text forecast) and the IMO open API at `api.vedur.is` (warnings, earthquakes, station metadata), and serves the built frontend on the same port. TTL cache with single-flight deduplication; upstream calls time out after 15 s.
- **Frontend:** Vite + TypeScript, no UI framework. Each panel is one module that implements a small `Panel` interface and draws its own DOM and SVG.
- **Fonts:** Routed Gothic (self-hosted, OFL) for lettering, Sixtyfour for the large readouts, VT323 for small values.
- **Deploy:** Docker + Traefik on `traeficvm`, with automatic deploys from a self-hosted GitHub Actions runner.

## API

| Endpoint | Purpose |
|---|---|
| `/api/obs?station=ID` | Current observations for one station |
| `/api/obs-multi?ids=…` | Temperature and wind for the map stations (one upstream call; the list is fixed on the server) |
| `/api/forecast?station=ID` | Station forecast |
| `/api/warnings?lat=…&lon=…` | Active warnings near a point |
| `/api/textaspa` | Text forecast |
| `/api/quakes` | Recent earthquakes |
| `/api/station-info?id=ID` | Station name and coordinates, from the IMO Weather API |
| `/api/health` | Liveness probe |
| `/stodvar` | HTML page: all active weather stations with numbers, searchable (from the IMO Weather API, cached 24 h) |

See [`architecture.md`](./architecture.md) for cache times and internals.

## Running locally

```bash
npm ci
npm run dev        # Vite on :5173 and the API server on :8080
```

Open `http://localhost:5173`. Vite proxies `/api` to the server. To run only the API server, use `npm run dev:server`.

Production-style run:

```bash
npm run build
npm start          # http://localhost:8080
```

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`. The self-hosted runner on `traeficvm` then runs:

```bash
sudo /opt/vedurstod-turbo/scripts/deploy-traefikvm.sh
```

The script resets the checkout to `origin/main` and rebuilds and recreates the container. No secrets or SSH keys are needed, because the runner is on the server.

Important:

- The `docker-compose.yml` in this repo is **not** used in production. The live `vedur` service is defined in `/opt/traefik/docker-compose.yml` on the VM.
- The sudoers rule on the VM names the deploy script path. If you rename the script, update sudoers too.
- vedur.is does not send its intermediate TLS certificate. The `Dockerfile` installs `globalsign-intermediate.pem` and sets `NODE_EXTRA_CA_CERTS`. Do not remove these steps, or `/api/warnings` fails silently.

## Adding a data stream

1. Add `server/sources/<name>.js`: fetch, parse, and return through `cached()`.
2. Add a route in `server/index.js#handleApi`.
3. Add `web/panels/<name>.ts`, implementing the `Panel` interface.
4. Register it in the `PANELS` map in `web/main.ts`.

## Changelog

### 1.0 (November 2026)

- New phosphor console skin: amber and green outlines, Routed Gothic lettering, Bakelite cabinet.
- Sixtyfour pixel font for the large readouts.
- New **KORT** panel with Iceland and the capital area, backed by `/api/obs-multi`.
- Header sundial replaces the sunrise/sunset text.
- Footer version switch to go back to the 0.8 skin.
- Warnings use Veðurstofan's Icelandic event names and severity; the warning lamp pulses orange while warnings are active.
- Faster forecast scrolling (sky symbols drawn as two paths instead of 121 circles).
- Server: failed upstream calls are cached for 2 minutes, and requests time out after 15 s.
- Better phone layout for the map and panel titles.

### 0.8 (May–June 2026)

- **SKJÁLFTAR** earthquake panel and **SJÁVARFÖLL** tide estimate.
- Separate **HUGLEIÐINGAR VEÐURFRÆÐINGS** panel.
- Unlockable layout: drag, resize and minimise panels.
- Raspberry Pi deployment removed; `traeficvm` is the only deploy path.

### 0.7 (April 2026)

- Station tabs with preset import and export.
- Station lookup by number through `/api/station-info`.
- Pressure shown in mbar.
