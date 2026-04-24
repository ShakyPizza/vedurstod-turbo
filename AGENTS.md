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
- **TraefikVM / Docker**: `Dockerfile`, `.github/workflows/deploy.yml`, and `scripts/deploy-traefikvm.sh`

### TraefikVM deployment — critical facts

- **The `docker-compose.yml` in this repo is NOT used in production.** The live `vedur` service is defined in `/opt/traefik/docker-compose.yml` on `traeficvm` (192.168.11.10), alongside all other services.
- GitHub Actions triggers the self-hosted runner `traefikvm-vedur` (`/opt/github-runner-vedur/`, user `ghrunner`), which runs `sudo /opt/vedurstod-turbo/scripts/deploy-traefikvm.sh`.
- The sudoers rule for this path lives in `/etc/sudoers` and `/etc/sudoers.d/ghrunner` on the VM. If you rename the deploy script, you must update sudoers on the VM manually.
- The deploy script uses `git fetch + git reset --hard origin/main` (not `git pull`) to avoid local-change conflicts blocking deploys.
- Docker build uses `--build --force-recreate` to ensure the container is always recreated, even when the image layer cache produces an identical hash.

### vedur.is TLS issue

`vedur.is` does not send its intermediate certificate (`GlobalSign GCC R6 AlphaSSL CA 2025`) in the TLS handshake. Node.js inside alpine containers fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. The fix is in the `Dockerfile`:

1. `apk add ca-certificates` — installs the OS trust store
2. `globalsign-intermediate.pem` (bundled in repo root) is copied into the image and registered via `update-ca-certificates`
3. `NODE_EXTRA_CA_CERTS` env var points Node directly at the intermediate cert

Do not remove these steps from the Dockerfile — without them, `/api/warnings` will silently fail on every poll.
