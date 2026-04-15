# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

**Veðurstöð Turbo** — a personal Icelandic weather dashboard styled as a 1960s–70s industrial control panel. Runs on a Raspberry Pi via Tailscale. No UI framework, no backend framework, minimal dependencies.

## Commands

```bash
npm run dev          # Vite dev server on :5173 (proxies /api to :8080)
npm run dev:server   # Node API server on :8080 (run alongside dev)
npm run build        # Vite build → dist/
npm start            # Production: Node serves dist/ + API on :8080
npm run preview      # Vite preview of built dist/
```

For local dev, run both `dev:server` and `dev` in separate terminals.

## Architecture

**Two processes, one repo:**

- **`server/`** — plain Node.js ESM HTTP server (no framework). Routes `/api/*` to source loaders; serves `dist/` as static SPA fallback.
- **`web/`** — Vite + TypeScript. Imperative DOM/SVG construction, no UI framework.

**Panel contract** — every display is a `Panel` object:

```typescript
interface Panel {
  mount(root: HTMLElement, ctx: PanelContext): void;
  refresh(): void | Promise<void>;
  intervalMs: number;  // 0 = static; > 0 = auto-polled
}
```

`main.ts` queries all `[data-panel]` elements, instantiates each panel, calls `mount()` + `refresh()`, and sets up `setInterval()` for polling. Panels own their own fetch and render logic.

**Data flow:**

```
Browser panel → fetch /api/obs?station=1471&lat=…&lon=…
  → server/index.js#handleApi
  → server/sources/obs.js
  → cache.js#cached(key, ttl, loader)  ← single-flight deduplication
  → xmlweather.vedur.is (upstream XML)
```

**Caching** (`server/cache.js`): Map-backed TTL cache with single-flight deduplication — concurrent requests for the same key share one upstream fetch.

**Station selection**: persisted as `localStorage['vedurstod:station']` → `{ id, name, lat, lon }`. Station ID + coords are query params on every API call; cache keys include them (e.g. `obs:1471`, `warnings:64.1542:-22.027`). Two tabs can display different stations from the same server.

## Key non-obvious details

- **Decimal parsing**: vedur.is uses Icelandic commas (`1,5` not `1.5`). `server/sources/vedur.js`'s `num()` replaces `,` → `.` before `parseFloat`.
- **Wind direction**: 16 Icelandic cardinal names (N, NNA, NA, ANA, A, …), not degrees. Panels map these to angles via a `DIRS` table.
- **Warnings scraping** (`server/sources/warnings.js`): extracts embedded CAP JSON from a JS literal using balanced-brace counting (not regex), then runs a ray-casting point-in-polygon test against station coords. Filters to `is-IS` alerts only.
- **Moon terminator** (`web/panels/moon.ts`): `moonLitPath(R, k, phase)` computes SVG arc path for the illuminated region. Waxing/waning and crescent/gibbous determine arc sweep flags.
- **No state management**: all panel state is local to the panel function scope. Each `refresh()` re-fetches and re-renders.
- **SVG is built imperatively**: `svg(tag, attrs, ...children)` helper from `web/panels/types.ts` (namespace-aware). Wind compass, moon orb, and forecast symbols are all constructed this way.

## Adding a new data stream (tides, earthquakes, traffic)

Three files + one registration:

1. `server/sources/tides.js` — fetch, parse, return via `cached()`
2. Add a `case '/api/tides':` in `server/index.js#handleApi`
3. `web/panels/tides.ts` — implement the `Panel` interface
4. Register in the `PANELS` map in `web/main.ts`

Placeholder slots (`SJÁVARFÖLL`, `SKJÁLFTAR`, `UMFERÐ`) are already in `index.html`.

## Production deployment (traeficvm)

The `docker-compose.yml` in this repo is **not used in production**. The live site is defined in `/opt/traefik/docker-compose.yml` on `traeficvm` (192.168.11.10), alongside all other services (traefik, launareiknir, heimasida, etc.). The `vedur` service there uses `build: /opt/vedurstod-turbo`.

The deploy script (`/opt/vedurstod-turbo/deploy.sh` on the VM) does:
```
cd /opt/vedurstod-turbo && git pull
cd /opt/traefik && docker compose build vedur && docker compose up -d vedur
```

**Never edit the repo's `docker-compose.yml` expecting it to affect the live site.**

## To do

- [x] **Docker + Traefik deployment (`vedur.benediktorri.is`)** — add a `docker-compose.yml` that builds a multi-stage image (Node build stage → Node runtime), exposes port 8080, and includes Traefik labels for `vedur.benediktorri.is` with `certresolver=letsencrypt`. No OAuth needed (public site). Follows the same pattern as `launareiknir` on `traeficvm` (VM 109, `192.168.11.10`). Keep the existing Pi/Tailscale systemd setup untouched — this is a separate deployment target.
- [x] **GitHub Actions deploy on push to main** — add `.github/workflows/deploy.yml` using the self-hosted runner on `traeficvm` (same runner used by `launareiknir`). On push to main: `docker compose build vedur && docker compose up -d vedur`. Mirrors the `launareiknir` deploy flow exactly.
- [x] **Single dev command** — running `npm run dev` should start both the Vite dev server and the Node API server concurrently. Use a tool like `concurrently` or `npm-run-all` to run `dev:server` and the Vite server in parallel from one command.
- [x] **Station dropdown in "Stilla Stöð" dialog** — replace the free-text station input with a `<select>` populated from a `web/stations.json` file. Each entry: `{ id, name, lat, lon }`. On selection, call `saveStation()` and reload. The JSON should cover the main vedur.is observation stations around Iceland.

## Deployment (Raspberry Pi)

Auto-deploys via systemd timer polling GitHub every 60 s — webhooks can't reach a Tailnet-only host. `scripts/deploy.sh` is idempotent: fetches origin/main, compares HEAD, runs `npm ci` only if lockfile changed, builds, restarts.

```bash
# First-time Pi setup
npm ci && npm run build
cp systemd/* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now vedurstod-turbo.service
systemctl --user enable --now vedurstod-turbo-deploy.timer
sudo loginctl enable-linger $USER
```
