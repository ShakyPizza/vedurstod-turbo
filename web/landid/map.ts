// The Landsspá map: coastline, graticule and one readout module per
// station. Modules sit beside their station's pin and are placed so they do
// not cover each other; a module that cannot fit is hidden (overview
// stations are always kept). The Hálendið view also draws glaciers, lakes,
// the highland crossings and a few landmark names; a name that would cover a
// station is left out.

import { project } from '../panels/iceland-shape.ts';
import { METRO_LAND_PATH } from '../panels/metro-shape.ts';
import { COAST_LO } from './coast-lo.ts';
import {
  type ForecastStore,
  type MapLabel,
  type Region,
  type StationDef,
  type ViewBox,
  esc,
  fmtInt,
  fmtTemp,
  isFrost,
  regionStations,
  regionViewBox,
  skySymbol,
  stationXY,
  windArrow,
} from './data.ts';

interface Coast {
  q: number;
  d: string;
}

// The detailed coastline (~200 kB) is only fetched for zoomed regions.
let coastHi: Coast | null = null;
let coastHiLoad: Promise<Coast | null> | null = null;
function loadCoastHi(): Promise<Coast | null> {
  coastHiLoad ??= fetch('/data/coast-hi.json')
    .then((r) => (r.ok ? (r.json() as Promise<Coast>) : null))
    .then((c) => (coastHi = c))
    .catch(() => null);
  return coastHiLoad;
}

const ZOOMED_BELOW = 700; // viewBox width under which the detailed coast is used

interface Highland {
  q: number;
  /** One path per polygon (outer ring plus holes). */
  glaciers: string[];
  lakes: string[];
  roads: string;
}

// Glaciers, lakes and roads for the Hálendið view (~56 kB), fetched when needed.
let highland: Highland | null = null;
let highlandLoad: Promise<Highland | null> | null = null;
function loadHighland(): Promise<Highland | null> {
  highlandLoad ??= fetch('/data/highland.json')
    .then((r) => (r.ok ? (r.json() as Promise<Highland>) : null))
    .then((h) => (highland = h))
    .catch(() => null);
  return highlandLoad;
}

interface LabelItem {
  def: MapLabel;
  el: HTMLElement;
  sx: number;
  sy: number;
}

interface Item {
  def: StationDef;
  el: HTMLButtonElement;
  pin: HTMLElement;
  keep: boolean;
  sx: number;
  sy: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

let uid = 0;

function mapSvg(vb: ViewBox, layers: Highland | null): string {
  const id = `lpm${++uid}`;
  const k = vb.w / 1000;
  let grid = '';
  if (!vb.metro) {
    for (let lat = 63; lat <= 67; lat += 0.5) {
      const [x0, y] = project(lat, -26);
      const [x1] = project(lat, -12);
      const major = Number.isInteger(lat);
      grid += `<line class="lp-grat${major ? '' : ' lp-grat--minor'}" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
      if (major) grid += `<text class="lp-grat__label" x="${vb.x + 6 * k}" y="${y - 4 * k}" font-size="${16 * k}">${lat}°N</text>`;
    }
    for (let lon = -26; lon <= -12; lon += 1) {
      const [x, y0] = project(67.2, lon);
      const [, y1] = project(62.8, lon);
      const major = lon % 2 === 0;
      grid += `<line class="lp-grat${major ? '' : ' lp-grat--minor'}" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`;
      if (major) grid += `<text class="lp-grat__label" x="${x + 4 * k}" y="${vb.y + vb.h - 6 * k}" font-size="${16 * k}">${-lon}°V</text>`;
    }
  }
  const zoomed = vb.w < ZOOMED_BELOW;
  const level = zoomed && coastHi ? coastHi : COAST_LO;
  const scaled = (cls: string, c: Coast) =>
    `<g transform="scale(${1 / c.q})"><path class="${cls}" d="${c.d}"/></g>`;
  // The glow follows the smoother outline so detailed fjords do not blotch.
  const glow = vb.metro
    ? `<path class="lp-land-glow" d="${METRO_LAND_PATH}"/>`
    : scaled('lp-land-glow', COAST_LO);
  const land = vb.metro
    ? `<path class="lp-land" d="${METRO_LAND_PATH}"/>`
    : scaled(`lp-land${level === coastHi ? ' lp-land--fine' : ''}`, level);
  // Neighbouring glaciers (and lakes) share edges and overlap a little.
  // Outlines go underneath and fills on top, so only the outer edge of a
  // group shows and the divides between its parts are covered.
  const shapes = (cls: string, list: string[]) =>
    `<g class="${cls}__edge">${list.map((d) => `<path d="${d}"/>`).join('')}</g>` +
    `<g class="${cls}">${list.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const extra = layers
    ? `<g transform="scale(${1 / layers.q})">
        ${shapes('lp-lake', layers.lakes)}
        ${shapes('lp-glacier', layers.glaciers)}
        <path class="lp-road" d="${layers.roads}"/>
      </g>`
    : '';
  const sp = 7 * k;
  return `<svg viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <pattern id="${id}p" width="${sp}" height="${sp}" patternUnits="userSpaceOnUse"><rect class="lp-sea" width="${sp}" height="${sp}"/><line class="lp-sea__line" x1="0" y1="${sp / 2}" x2="${sp}" y2="${sp / 2}" stroke-width="${k * 0.8}"/></pattern>
      <filter id="${id}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${3 * k}"/></filter>
    </defs>
    <rect x="${vb.x - 50}" y="${vb.y - 50}" width="${vb.w + 100}" height="${vb.h + 100}" fill="url(#${id}p)"/>
    ${grid}
    <g filter="url(#${id}b)">${glow}</g>
    ${land}
    ${extra}
  </svg>`;
}

export interface MapView {
  setRegion(r: Region): void;
  paint(store: ForecastStore, ti: number, selected: number): void;
  setNames(on: boolean): void;
  relayout(): void;
}

export function createMap(wrap: HTMLElement, onSelect: (id: number) => void): MapView {
  let region: Region;
  let vb: ViewBox;
  let items: Item[] = [];
  let labels: LabelItem[] = [];
  let showNames = false;
  let svgHost: HTMLElement;

  function drawCoast() {
    svgHost.innerHTML = mapSvg(vb, region.highland ? highland : null);
  }

  function setRegion(r: Region) {
    region = r;
    vb = regionViewBox(r);
    wrap.style.aspectRatio = `${vb.w} / ${vb.h}`;
    // Keep tall views (the capital area) from growing past the screen.
    wrap.style.maxWidth = `${Math.round((820 * vb.w) / vb.h)}px`;
    wrap.replaceChildren();
    svgHost = document.createElement('div');
    svgHost.className = 'lp-map__svg';
    const mods = document.createElement('div');
    mods.className = 'lp-map__mods';
    wrap.append(svgHost, mods);
    drawCoast();
    if (!vb.metro && vb.w < ZOOMED_BELOW && !coastHi) {
      const want = r;
      void loadCoastHi().then(() => {
        if (region === want && coastHi) drawCoast();
      });
    }
    if (r.highland && !highland) {
      const want = r;
      void loadHighland().then(() => {
        if (region === want && highland) drawCoast();
      });
    }
    items = regionStations(r).map((def) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'lp-mod';
      el.title = def.name;
      el.addEventListener('click', () => onSelect(def.id));
      const pin = document.createElement('span');
      pin.className = `lp-pin${def.highland ? ' lp-pin--high' : ''}`;
      mods.append(pin, el);
      return { def, el, pin, keep: !!def.overview || !!r.metro, sx: 0, sy: 0 };
    });
    labels = (r.labels ?? []).map((def) => {
      const el = document.createElement('span');
      el.className = `lp-lbl lp-lbl--${def.kind}`;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML =
        def.kind === 'peak' || def.kind === 'place'
          ? `<i class="lp-lbl__mark"></i><span>${esc(def.text)}</span>`
          : `<span>${esc(def.text)}</span>`;
      // Under the station readouts in stacking order.
      mods.prepend(el);
      return { def, el, sx: 0, sy: 0 };
    });
    applyNames();
  }

  function applyNames() {
    wrap.classList.toggle('lp-map--names', showNames || !!region.bbox || !!region.metro);
  }

  function relayout() {
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (!W || !H) return;
    wrap.classList.toggle('lp-map--compact', W < 900 && W >= 560);
    wrap.classList.toggle('lp-map--tiny', W < 560);
    for (const it of items) {
      const [x, y] = stationXY(vb, it.def);
      it.sx = ((x - vb.x) / vb.w) * W;
      it.sy = ((y - vb.y) / vb.h) * H;
      it.pin.style.left = `${it.sx}px`;
      it.pin.style.top = `${it.sy}px`;
    }
    const taken = place(W, H);
    for (const l of labels) {
      const [x, y] = stationXY(vb, { lat: l.def.lat, lon: l.def.lon } as StationDef);
      l.sx = ((x - vb.x) / vb.w) * W;
      l.sy = ((y - vb.y) / vb.h) * H;
    }
    placeLabels(taken, W, H);
  }

  // Landmark names go where the station readouts left room. Area names
  // (glaciers, lakes, roads) are centred on their point; peaks and places
  // have a mark on the point and the name beside it.
  function placeLabels(taken: Rect[], W: number, H: number) {
    for (const l of labels) {
      l.el.classList.remove('lp-lbl--left');
      l.el.style.visibility = '';
      const marked = l.def.kind === 'peak' || l.def.kind === 'place';
      const tries: Array<{ left: boolean; dx: number; dy: number }> = marked
        ? [{ left: false, dx: 0, dy: 0 }, { left: true, dx: 0, dy: 0 }]
        : [{ left: false, dx: 0, dy: 0 }, { left: false, dx: 0, dy: -16 }, { left: false, dx: 0, dy: 16 }];
      let ok: Rect | null = null;
      for (const t of tries) {
        l.el.classList.toggle('lp-lbl--left', t.left);
        const w = l.el.offsetWidth;
        const h = l.el.offsetHeight;
        // Marked names: the mark (5px from the label's edge) sits on the point.
        const x = marked ? (t.left ? l.sx - w + 5 : l.sx - 5) : l.sx - w / 2 + t.dx;
        const y = l.sy - h / 2 + t.dy;
        const r = { x, y, w, h };
        const inside = r.x >= 0 && r.y >= 0 && r.x + w <= W && r.y + h <= H;
        if (inside && !taken.some((p) => overlap(r, p) > 0)) {
          ok = r;
          break;
        }
      }
      l.el.style.visibility = ok ? '' : 'hidden';
      if (!ok) continue;
      l.el.style.left = `${ok.x}px`;
      l.el.style.top = `${ok.y}px`;
      taken.push(ok);
    }
  }

  // Greedy placement: try eight sides of the pin, take the first free one,
  // else the one with least overlap. Modules that would overlap are hidden
  // unless they must be kept.
  function place(W: number, H: number): Rect[] {
    const pins = items.map((it) => ({ it, r: { x: it.sx - 5, y: it.sy - 5, w: 10, h: 10 } }));
    const placed: Rect[] = [];
    const g = 5;
    for (const it of items) {
      if (it.el.hidden) {
        it.pin.hidden = true;
        continue;
      }
      it.el.style.visibility = '';
      const w = it.el.offsetWidth;
      const h = it.el.offsetHeight;
      const sides: Array<[number, number]> = [
        [-g - w, -h / 2], [g, -h / 2], [-w / 2, -g - h], [-w / 2, g],
        [-w - g / 2, -h - g / 2], [g / 2, -h - g / 2], [-w - g / 2, g / 2], [g / 2, g / 2],
      ];
      let best: { r: Rect; cost: number } | null = null;
      for (const [dx, dy] of sides) {
        const r = { x: it.sx + dx, y: it.sy + dy, w, h };
        let cost = 0;
        for (const p of placed) cost += overlap(r, p);
        for (const p of pins) if (p.it !== it) cost += overlap(r, p.r) * 2;
        cost += (Math.max(0, -r.x) + Math.max(0, r.x + w - W) + Math.max(0, -r.y) + Math.max(0, r.y + h - H)) * 60;
        if (!best || cost < best.cost) best = { r, cost };
        if (cost === 0) break;
      }
      const hide = best!.cost > 0 && !it.keep;
      it.el.style.visibility = hide ? 'hidden' : '';
      it.pin.hidden = hide;
      it.el.style.left = `${best!.r.x}px`;
      it.el.style.top = `${best!.r.y}px`;
      if (!hide) placed.push(best!.r);
    }
    return [...placed, ...pins.filter((p) => !p.it.pin.hidden).map((p) => p.r)];
  }

  function paint(store: ForecastStore, ti: number, selected: number) {
    for (const it of items) {
      const s = store.series.get(it.def.id);
      // A station with no forecast in this run is left off the map.
      it.el.hidden = !s;
      if (!s) continue;
      const t = s.T[ti];
      const weather = store.weatherAt(s, ti) ?? '';
      it.el.classList.toggle('lp-mod--sel', it.def.id === selected);
      it.el.setAttribute(
        'aria-label',
        `${it.def.short}: ${fmtTemp(t)}, ${s.D[ti] ?? ''} ${fmtInt(s.F[ti])} m/s, ${weather}`,
      );
      it.el.innerHTML =
        skySymbol(store.sky(s, ti)) +
        `<span class="lp-mod__t${isFrost(t) ? ' lp-frost' : ''}">${fmtTemp(t)}</span>` +
        `<span class="lp-mod__w">${windArrow(s.D[ti])}${fmtInt(s.F[ti])}</span>` +
        `<span class="lp-mod__n">${esc(it.def.short)}</span>`;
    }
    requestAnimationFrame(relayout);
  }

  function setNames(on: boolean) {
    showNames = on;
    applyNames();
    requestAnimationFrame(relayout);
  }

  return { setRegion, paint, setNames, relayout };
}
