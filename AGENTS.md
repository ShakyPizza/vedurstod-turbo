# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

**Veðurstöð Turbo** — an Icelandic weather dashboard styled like a 1960s–70s industrial control panel. The repo has a plain Node server, a Vite + TypeScript frontend, and two supported deployment paths: Raspberry Pi + systemd and `traeficvm` + Docker + Traefik.

## Commands

```bash
npm run dev          # starts Vite on :5173 and the API server on :8080 together
npm run dev:server   # API server only
npm run build        # Vite build → dist/
npm start            # Production: Node serves dist/ + API on :8080
npm run preview      # Vite preview of built dist/
```

## Canonical docs

- [`README.md`](./README.md) — product overview, local dev, deployment entrypoints
- [`architecture.md`](./architecture.md) — runtime shape, API surface, panel model, deployment details

## Architecture snapshot

- `server/` is a framework-free Node ESM server that serves `dist/` and handles `/api/*`
- `web/` is Vite + TypeScript with imperative DOM/SVG rendering
- each panel owns its own fetch and render logic
- `server/cache.js` provides TTL caching with single-flight deduplication
- the implemented API surface is `/api/obs`, `/api/forecast`, `/api/warnings`, `/api/textaspa`, and `/api/health`

## Key details

- **Decimal parsing**: vedur.is uses Icelandic commas (`1,5` not `1.5`). `server/sources/vedur.js`'s `num()` replaces `,` → `.` before `parseFloat`.
- **Wind direction**: 16 Icelandic cardinal names (N, NNA, NA, ANA, A, …), not degrees. Panels map these to angles via a `DIRS` table.
- **Warnings scraping** (`server/sources/warnings.js`): extracts embedded CAP JSON from a JS literal using balanced-brace counting (not regex), then runs a ray-casting point-in-polygon test against station coords. Filters to `is-IS` alerts only.
- **Text forecast**: `server/sources/textaspa.js` is active and the output is rendered inside `web/panels/obs.ts`.
- **Moon terminator** (`web/panels/moon.ts`): `moonLitPath(R, k, phase)` computes SVG arc path for the illuminated region. Waxing/waning and crescent/gibbous determine arc sweep flags.
- **Station selection**: `web/stations.json` feeds the station dropdown, but the dialog fields remain editable for custom stations.

## Adding a new data stream (tides, earthquakes, traffic)

Three files + one registration:

1. `server/sources/tides.js` — fetch, parse, return via `cached()`
2. Add a `case '/api/tides':` in `server/index.js#handleApi`
3. `web/panels/tides.ts` — implement the `Panel` interface
4. Register in the `PANELS` map in `web/main.ts`

Placeholder slots (`SJÁVARFÖLL`, `SKJÁLFTAR`, `UMFERÐ`) are already in `index.html`.

## Deployment paths

- **Raspberry Pi / Tailnet**: `systemd/` + `scripts/deploy-pi.sh`
- **TraefikVM / Docker**: `Dockerfile`, `docker-compose.yml`, `.github/workflows/deploy.yml`, and `scripts/deploy-traefikvm.sh`

Use the canonical docs for exact operational steps instead of duplicating them here.
