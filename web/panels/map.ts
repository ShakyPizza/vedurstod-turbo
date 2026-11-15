import type { Panel, PanelContext } from './types.ts';
import { el, svg, getJson } from './types.ts';
import { ICELAND_PATH, MAP_H, MAP_W, project } from './iceland-shape.ts';
import { METRO_H, METRO_LAND_PATH, METRO_W, inMetro, projectMetro } from './metro-shape.ts';

// KORT: one screen with two views. The island on the left and the capital
// area on the right (stacked on narrow screens). Lamp colour shows data
// status, the marker shape shows town or highland, and labels are placed
// automatically so they never cover each other.

/** Where the label sits relative to the lamp. */
type Anchor = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type ViewKey = 'island' | 'metro';

interface MapStation {
  id: number;
  /** Short name shown on the map. */
  name: string;
  /** Full name for the detail row, when it differs. */
  full?: string;
  lat: number;
  lon: number;
  highland?: boolean;
  /** Preferred label position; the placer falls back to others. */
  label: Anchor;
}

// Listed in priority order: earlier stations get their label placed first.
// The server only serves these IDs: keep in step with MAP_STATION_IDS in
// server/sources/obs.js.
const ISLAND_STATIONS: MapStation[] = [
  { id: 1, name: 'Reykjavík', lat: 64.127, lon: -21.902, label: 'e' },
  { id: 3471, name: 'Akureyri', lat: 65.683, lon: -18.1, label: 's' },
  { id: 571, name: 'Egilsstaðir', lat: 65.283, lon: -14.401, label: 'w' },
  { id: 2644, name: 'Ísafjörður', lat: 66.067, lon: -23.133, label: 'e' },
  { id: 990, name: 'Keflavík', lat: 63.985, lon: -22.605, label: 'sw' },
  { id: 6300, name: 'Selfoss', lat: 63.933, lon: -21.0, label: 'se' },
  { id: 5544, name: 'Höfn', lat: 64.267, lon: -15.2, label: 'e' },
  { id: 6015, name: 'Vestmannaeyjar', lat: 63.44, lon: -20.27, label: 's' },
  { id: 3696, name: 'Húsavík', lat: 66.043, lon: -17.34, label: 'e' },
  { id: 3433, name: 'Sauðárkrókur', lat: 65.733, lon: -19.567, label: 'n' },
  { id: 178, name: 'Stykkishólmur', lat: 65.073, lon: -22.733, label: 'e' },
  { id: 2319, name: 'Patreksfjörður', lat: 65.6, lon: -23.967, label: 's' },
  { id: 3317, name: 'Blönduós', lat: 65.667, lon: -20.3, label: 'sw' },
  { id: 6272, name: 'Klaustur', full: 'Kirkjubæjarklaustur', lat: 63.783, lon: -18.05, label: 's' },
  { id: 4828, name: 'Raufarhöfn', lat: 66.452, lon: -15.952, label: 'e' },
  { id: 6935, name: 'Hveravellir', lat: 64.873, lon: -19.553, highland: true, label: 'w' },
  { id: 6748, name: 'Setur', lat: 64.628, lon: -18.938, highland: true, label: 'e' },
  { id: 6670, name: 'Jökulheimar', lat: 64.31, lon: -18.237, highland: true, label: 'e' },
];

const METRO_STATIONS: MapStation[] = [
  { id: 1, name: 'Reykjavík', lat: 64.1289, lon: -21.9082, label: 'n' },
  { id: 1471, name: 'Seltjarnarnes', full: 'Seltjarnarnes Suðurnes', lat: 64.1545, lon: -22.0325, label: 'n' },
  { id: 1472, name: 'Kópavogur', full: 'Kópavogur Fossvogsdalur', lat: 64.1163, lon: -21.8617, label: 's' },
  { id: 1579, name: 'Mosfellsbær', full: 'Mosfellsbær Blikastaðanes', lat: 64.1669, lon: -21.7437, label: 's' },
  { id: 1474, name: 'Garðabær', full: 'Garðabær Urriðaholt', lat: 64.0712, lon: -21.9107, label: 'e' },
  { id: 1473, name: 'Straumsvík', lat: 64.0438, lon: -22.0404, label: 'e' },
  { id: 1480, name: 'Geldinganes', lat: 64.1678, lon: -21.8038, label: 'n' },
  { id: 1482, name: 'Víðidalur', full: 'Reykjavík Víðidalur', lat: 64.1035, lon: -21.7971, label: 'e' },
  { id: 1477, name: 'Flugvöllur', full: 'Reykjavíkurflugvöllur', lat: 64.1284, lon: -21.9407, label: 'sw' },
  { id: 1478, name: 'Geirsnef', full: 'Reykjavík Geirsnef', lat: 64.1281, lon: -21.8409, label: 'n' },
  { id: 1481, name: 'Hólmsheiði', lat: 64.1085, lon: -21.6864, label: 'nw' },
  { id: 1578, name: 'Skrauthólar', lat: 64.2318, lon: -21.8046, label: 'e' },
];

const ALL_IDS = [...new Set([...ISLAND_STATIONS, ...METRO_STATIONS].map((s) => s.id))];

/** A reading older than this shows an amber lamp instead of green. */
const STALE_MS = 3 * 60 * 60 * 1000;

interface MultiObs {
  fetchedAt: string;
  stations: Array<{
    stationId: number;
    stationName: string;
    observedAt: string | null;
    temperature: number | null;
    wind: { speed: number | null; gust: number | null; direction: string | null };
  }>;
}

const DIRS: Record<string, number> = {
  N: 0, NNA: 22.5, NA: 45, ANA: 67.5, A: 90, ASA: 112.5, SA: 135, SSA: 157.5,
  S: 180, SSV: 202.5, SV: 225, VSV: 247.5, V: 270, VNV: 292.5, NV: 315, NNV: 337.5,
};

const UNIT: Record<Anchor, [number, number]> = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [0.8, -0.8], nw: [-0.8, -0.8], se: [0.8, 0.8], sw: [-0.8, 0.8],
};
const FALLBACK: Anchor[] = ['e', 'w', 's', 'n', 'ne', 'se', 'nw', 'sw'];

/** Sizes in viewBox units, per layout. */
interface Sizes { temp: number; name: number; gap: number; lamp: number; vane: number; vaneK: number }

interface Layout {
  key: 'wide' | 'tall';
  w: number;
  h: number;
  island: { s: number; x: number; y: number };
  metro: { s: number; x: number; y: number };
  sizes: Sizes;
}

const PAD = 24; // island margin for graticule labels, in island units

function layoutFor(kind: 'wide' | 'tall'): Layout {
  if (kind === 'wide') {
    // Island left, capital area right; about 2.1 : 1.
    return {
      key: 'wide', w: 1600, h: 760,
      island: { s: 0.95, x: 30, y: 36 },
      metro: { s: 1.36, x: 1036, y: 76 },
      sizes: { temp: 34, name: 15, gap: 14, lamp: 6, vane: 9, vaneK: 1.3 },
    };
  }
  // Island on top, capital area below, for phones.
  return {
    key: 'tall', w: 1000, h: 1800,
    island: { s: 0.95, x: 30, y: 36 },
    metro: { s: 1.95, x: 110, y: 830 },
    sizes: { temp: 56, name: 25, gap: 20, lamp: 9, vane: 14, vaneK: 2 },
  };
}

function fmtTemp(t: number | null): string {
  if (t === null || Number.isNaN(t)) return '—';
  const r = Math.round(t);
  return `${r === 0 ? '0' : r}°`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Intl.DateTimeFormat('is-IS', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Atlantic/Reykjavik',
  }).format(new Date(iso));
}

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

interface StationNode {
  def: MapStation;
  view: ViewKey;
  /** Position in viewBox units for the current layout. */
  x: number;
  y: number;
  group: SVGElement;
  temp: SVGElement;
  name: SVGElement;
  vane: SVGElement;
  label: SVGElement;
  plate: SVGElement;
  marker: SVGElement;
  shown: boolean;
}

export function mapPanel(): Panel {
  let ctx: PanelContext;
  let lamp: HTMLElement;
  let lampLabel: HTMLElement;
  let stamp: HTMLElement;
  let detail: HTMLElement;
  let root: SVGSVGElement;
  let islandG: SVGElement;
  let metroG: SVGElement;
  let metroClip: SVGElement;
  let metroFrame: SVGElement;
  let metroTitle: SVGElement;
  let seaName: SVGElement;
  let divider: SVGElement;
  let bracket: SVGElement;
  let lead: SVGElement;
  let home: SVGElement;
  let layout: Layout = layoutFor('wide');
  const nodes: StationNode[] = [];
  let data = new Map<number, MultiObs['stations'][number]>();
  let selected: number | null = null;

  const toVb = (view: ViewKey, px: number, py: number): [number, number] => {
    const t = view === 'island' ? layout.island : layout.metro;
    return [t.x + px * t.s, t.y + py * t.s];
  };

  /** The part of the screen each view's labels must stay inside. */
  function viewBounds(view: ViewKey): Rect {
    if (view === 'island') {
      const [x0, y0] = toVb('island', -PAD + 4, -PAD + 4);
      const [x1, y1] = toVb('island', MAP_W + PAD - 4, MAP_H + PAD - 4);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const [x0, y0] = toVb('metro', 0, 0);
    const [x1, y1] = toVb('metro', METRO_W, METRO_H);
    return { x: x0 + 2, y: y0 + 2, w: x1 - x0 - 4, h: y1 - y0 - 4 };
  }

  function showDetail(id: number | null) {
    selected = id;
    for (const n of nodes) n.group.classList.toggle('map-stn--selected', n.def.id === id);
    const def = [...ISLAND_STATIONS, ...METRO_STATIONS].find((s) => s.id === id);
    const obs = id !== null ? data.get(id) : undefined;
    if (!def) {
      // Nothing selected: the detail row stays empty and takes no space.
      detail.replaceChildren();
      return;
    }
    const cell = (label: string, value: string, unit = '') =>
      el(
        'div',
        { class: 'map__detail-cell' },
        el('span', { class: 'map__detail-label' }, label),
        el('span', { class: 'map__detail-value' }, value, unit ? el('span', { class: 'map__detail-unit' }, unit) : ''),
      );
    const w = obs?.wind;
    detail.replaceChildren(
      el('span', { class: 'map__detail-name' }, def.full ?? def.name),
      cell('HITI', obs?.temperature != null ? obs.temperature.toFixed(1) : '—', '°C'),
      cell('VINDUR', w?.speed != null ? String(w.speed) : '—', 'm/s'),
      cell('ÁTT', w?.direction ?? '—'),
      cell('HVIÐA', w?.gust != null ? String(w.gust) : '—', 'm/s'),
      cell('MÆLT', fmtTime(obs?.observedAt ?? null)),
    );
  }

  function buildStation(def: MapStation, view: ViewKey, layer: SVGElement, i: number): StationNode {
    const group = svg('g', {
      class: `map-stn${def.highland ? ' map-stn--highland' : ''}`,
      tabindex: 0,
      role: 'button',
      'aria-label': def.full ?? def.name,
      style: `--i:${i}`,
    });
    const vane = svg('line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'map-stn__vane', 'marker-end': 'url(#map-arrow)' });
    const marker = def.highland ? svg('rect', { class: 'map-stn__lamp' }) : svg('circle', { class: 'map-stn__lamp' });
    const temp = svg('text', { class: 'map-stn__temp' }, '—');
    const name = svg('text', { class: 'map-stn__name' }, def.name.toUpperCase());
    const plate = svg('rect', { class: 'map-stn__plate', rx: 2 });
    const label = svg('g', { class: 'map-stn__label' }, plate, temp, name);
    group.append(vane, marker, label);
    const pick = () => showDetail(selected === def.id ? null : def.id);
    group.addEventListener('click', pick);
    group.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') {
        ev.preventDefault();
        pick();
      }
    });
    layer.append(group);
    // Hidden until the first reading arrives and labels are placed.
    label.style.display = 'none';
    return { def, view, x: 0, y: 0, group, temp, name, vane, label, plate, marker, shown: false };
  }

  function buildMap(): SVGSVGElement {
    root = svg('svg', {
      class: 'map-scope',
      role: 'img',
      'aria-label': 'Kort af Íslandi og höfuðborgarsvæðinu með veðurstöðvum',
      preserveAspectRatio: 'xMidYMid meet',
    }) as SVGSVGElement;

    metroClip = svg('rect');
    root.append(
      svg(
        'defs',
        {},
        svg(
          'filter',
          { id: 'map-bloom', x: '-50%', y: '-50%', width: '200%', height: '200%' },
          svg('feGaussianBlur', { stdDeviation: 3.5, result: 'b' }),
          svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })),
        ),
        svg(
          'marker',
          { id: 'map-arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4.5, markerHeight: 4.5, orient: 'auto' },
          svg('path', { d: 'M0 1L9 5L0 9Z', class: 'map-stn__arrow' }),
        ),
        svg(
          'pattern',
          { id: 'map-sea', width: 6, height: 6, patternUnits: 'userSpaceOnUse' },
          svg('rect', { width: 6, height: 6, class: 'map-sea__bg' }),
          svg('line', { x1: 0, y1: 3, x2: 6, y2: 3, class: 'map-sea__line' }),
        ),
        svg('clipPath', { id: 'map-metro-clip' }, metroClip),
      ),
    );

    // Island: graticule (1° latitude, 2° longitude) and coastline.
    islandG = svg('g', { class: 'map-view map-view--island' });
    const grid = svg('g', { class: 'map-grid' });
    for (let lat = 63.5; lat <= 66.5; lat += 0.5) {
      const [x0, y] = project(lat, -25);
      const [x1] = project(lat, -13);
      const major = Number.isInteger(lat);
      grid.append(svg('line', { x1: x0, y1: y, x2: x1, y2: y, class: major ? 'map-grid__major' : 'map-grid__minor' }));
      if (major) grid.append(svg('text', { x: -PAD + 6, y: y - 5, class: 'map-grid__label' }, `${lat}°N`));
    }
    for (let lon = -24; lon <= -14; lon += 1) {
      const [x, y0] = project(67, lon);
      const [, y1] = project(63, lon);
      const major = lon % 2 === 0;
      grid.append(svg('line', { x1: x, y1: y0, x2: x, y2: y1, class: major ? 'map-grid__major' : 'map-grid__minor' }));
      if (major) grid.append(svg('text', { x: x + 5, y: MAP_H + PAD - 8, class: 'map-grid__label' }, `${-lon}°V`));
    }
    islandG.append(
      grid,
      svg('path', { d: ICELAND_PATH, class: 'map-land__glow', filter: 'url(#map-bloom)' }),
      svg('path', { d: ICELAND_PATH, class: 'map-land' }),
    );

    // Capital area: dark ruled sea, filled land, clipped to its frame.
    metroG = svg('g', { class: 'map-view map-view--metro' });
    metroG.append(
      svg('rect', { x: 0, y: 0, width: METRO_W, height: METRO_H, class: 'map-sea' }),
      svg('path', { d: METRO_LAND_PATH, class: 'map-metro-land__glow', filter: 'url(#map-bloom)' }),
      svg('path', { d: METRO_LAND_PATH, class: 'map-metro-land' }),
    );
    const metroWrap = svg('g', { 'clip-path': 'url(#map-metro-clip)' }, metroG);

    divider = svg('line', { class: 'map-divider' });
    metroFrame = svg('rect', { class: 'map-metro-frame' });
    metroTitle = svg('text', { class: 'map-metro-title' }, 'HÖFUÐBORGARSVÆÐIÐ');
    seaName = svg('text', { class: 'map-sea-name' }, 'FAXAFLÓI');
    bracket = svg('rect', { class: 'map-bracket' });
    lead = svg('path', { class: 'map-lead' });
    home = svg('path', { d: 'M-20 0H-10M10 0H20M0 -20V-10M0 10V20', class: 'map-home__cross' });

    const layer = svg('g', { class: 'map-stations' });
    root.append(islandG, metroWrap, metroFrame, divider, metroTitle, seaName, bracket, lead, svg('g', { class: 'map-home' }, home), layer);

    ISLAND_STATIONS.forEach((d, i) => nodes.push(buildStation(d, 'island', layer, i)));
    METRO_STATIONS.forEach((d, i) => nodes.push(buildStation(d, 'metro', layer, ISLAND_STATIONS.length + i)));
    return root;
  }

  /** Put every fixed part where the current layout wants it. */
  function applyLayout() {
    const L = layout;
    root.setAttribute('viewBox', `0 0 ${L.w} ${L.h}`);
    root.classList.toggle('map-scope--tall', L.key === 'tall');
    islandG.setAttribute('transform', `translate(${L.island.x} ${L.island.y}) scale(${L.island.s})`);
    metroG.setAttribute('transform', `translate(${L.metro.x} ${L.metro.y}) scale(${L.metro.s})`);
    const mx = L.metro.x, my = L.metro.y, mw = METRO_W * L.metro.s, mh = METRO_H * L.metro.s;
    for (const r of [metroClip, metroFrame]) {
      r.setAttribute('x', String(mx));
      r.setAttribute('y', String(my));
      r.setAttribute('width', String(mw));
      r.setAttribute('height', String(mh));
    }
    const sz = L.sizes;
    metroTitle.setAttribute('font-size', String(sz.name * 1.05));
    metroTitle.setAttribute('x', String(mx));
    metroTitle.setAttribute('y', String(my - sz.name * 0.9));
    const [sx, sy] = toVb('metro', 18, 64);
    seaName.setAttribute('x', String(sx));
    seaName.setAttribute('y', String(sy));
    seaName.setAttribute('font-size', String(sz.name * 1.1));

    // Box on the island around the area the right-hand map shows.
    const [b0x, b0y] = toVb('island', ...project(64.245, -22.09));
    const [b1x, b1y] = toVb('island', ...project(64.025, -21.66));
    bracket.setAttribute('x', String(b0x - 3));
    bracket.setAttribute('y', String(b0y - 3));
    bracket.setAttribute('width', String(b1x - b0x + 6));
    bracket.setAttribute('height', String(b1y - b0y + 6));
    if (L.key === 'wide') {
      const dx = (toVb('island', MAP_W + PAD, 0)[0] + mx) / 2;
      divider.setAttribute('x1', String(dx));
      divider.setAttribute('x2', String(dx));
      divider.setAttribute('y1', '16');
      divider.setAttribute('y2', String(L.h - 16));
      lead.setAttribute('d', `M${b1x + 3} ${(b0y + b1y) / 2}H${dx}`);
    } else {
      const dy = (toVb('island', 0, MAP_H + PAD)[1] + my - sz.name * 2) / 2;
      divider.setAttribute('x1', '16');
      divider.setAttribute('x2', String(L.w - 16));
      divider.setAttribute('y1', String(dy));
      divider.setAttribute('y2', String(dy));
      lead.setAttribute('d', `M${(b0x + b1x) / 2} ${b1y + 3}V${dy}`);
    }

    // Crosshair on the active tab's station: in the capital-area view when
    // it lies there, otherwise on the island.
    const st = ctx.station;
    const metroHome = inMetro(st.lat, st.lon);
    const [hx, hy] = metroHome ? toVb('metro', ...projectMetro(st.lat, st.lon)) : toVb('island', ...project(st.lat, st.lon));
    const k = sz.lamp / 6;
    home.setAttribute('transform', `translate(${hx.toFixed(1)} ${hy.toFixed(1)}) scale(${k.toFixed(2)})`);

    for (const n of nodes) {
      const [px, py] = n.view === 'island' ? project(n.def.lat, n.def.lon) : projectMetro(n.def.lat, n.def.lon);
      [n.x, n.y] = toVb(n.view, px, py);
      n.group.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
      const r = sz.lamp;
      if (n.def.highland) {
        n.marker.setAttribute('x', String(-r * 0.9));
        n.marker.setAttribute('y', String(-r * 0.9));
        n.marker.setAttribute('width', String(r * 1.8));
        n.marker.setAttribute('height', String(r * 1.8));
        n.marker.setAttribute('transform', 'rotate(45)');
      } else {
        n.marker.setAttribute('r', String(r));
      }
      n.temp.setAttribute('font-size', String(sz.temp));
      n.name.setAttribute('font-size', String(sz.name));
    }
  }

  /** Lay out the label for one candidate position; returns its plate box. */
  function setLabel(n: StationNode, a: Anchor, compact: boolean): Rect | null {
    const { temp: T, name: N, gap } = layout.sizes;
    const [ux, uy] = UNIT[a];
    const anchor = ux > 0.1 ? 'start' : ux < -0.1 ? 'end' : 'middle';
    const tx = ux * (gap + (uy === 0 ? 0 : 2));
    let tempY: number;
    let nameY: number;
    if (uy < 0) {
      tempY = -gap * (uy < -0.9 ? 1 : 0.7);
      nameY = tempY - T * 0.66 - 3;
    } else if (uy > 0) {
      tempY = gap * (uy > 0.9 ? 1 : 0.7) + T * 0.62;
      nameY = tempY + N + 2;
    } else {
      tempY = compact ? T * 0.3 : T * 0.12;
      nameY = tempY + N + 2;
    }
    for (const [t, y] of [[n.temp, tempY], [n.name, nameY]] as const) {
      t.setAttribute('x', tx.toFixed(1));
      t.setAttribute('y', y.toFixed(1));
      t.setAttribute('text-anchor', anchor);
    }
    n.name.style.display = compact ? 'none' : '';
    // Plate around the visible text.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of compact ? [n.temp] : [n.temp, n.name]) {
      const b = (t as SVGGraphicsElement).getBBox();
      if (!b.width) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
    if (!Number.isFinite(x0)) return null; // not rendered (minimized panel)
    const padX = N * 0.45, padY = N * 0.2;
    const r = { x: x0 - padX, y: y0 - padY, w: x1 - x0 + padX * 2, h: y1 - y0 + padY * 2 };
    n.plate.setAttribute('x', r.x.toFixed(1));
    n.plate.setAttribute('y', r.y.toFixed(1));
    n.plate.setAttribute('width', r.w.toFixed(1));
    n.plate.setAttribute('height', r.h.toFixed(1));
    return { x: r.x + n.x, y: r.y + n.y, w: r.w, h: r.h };
  }

  /**
   * Place labels in priority order. Each tries its preferred side, then the
   * others; a label that still does not fit shows only the temperature, and
   * as a last resort is hidden (the station stays clickable).
   */
  function placeLabels() {
    for (const view of ['island', 'metro'] as const) {
      const bounds = viewBounds(view);
      const inView = nodes.filter((n) => n.view === view && n.shown);
      const lampR = layout.sizes.lamp + 3;
      const lamps = inView.map((n) => ({ n, r: { x: n.x - lampR, y: n.y - lampR, w: lampR * 2, h: lampR * 2 } }));
      const placed: Rect[] = [];
      for (const n of inView) {
        const order = [n.def.label, ...FALLBACK.filter((a) => a !== n.def.label)];
        // A label hidden on an earlier pass must be visible to be measured.
        n.label.style.display = '';
        let done = false;
        for (const compact of [false, true]) {
          for (const a of order) {
            const r = setLabel(n, a, compact);
            if (!r) return;
            const free =
              inside(r, bounds) &&
              !placed.some((p) => overlaps(p, r)) &&
              !lamps.some((l) => l.n !== n && overlaps(l.r, r));
            if (free) {
              placed.push(r);
              done = true;
              break;
            }
          }
          if (done) break;
        }
        n.label.style.display = done ? '' : 'none';
      }
    }
  }

  function paint() {
    const now = Date.now();
    for (const n of nodes) {
      const obs = data.get(n.def.id);
      const t = obs?.temperature ?? null;
      const hasData = !!obs && t !== null;
      const age = obs?.observedAt ? now - new Date(obs.observedAt).getTime() : Infinity;
      n.shown = hasData;
      n.temp.textContent = fmtTemp(t);
      n.group.classList.toggle('map-stn--frost', t !== null && t < 0);
      n.group.classList.toggle('map-stn--nodata', !hasData);
      n.group.classList.toggle('map-stn--live', hasData && age <= STALE_MS);
      n.group.classList.toggle('map-stn--stale', hasData && age > STALE_MS);
      const dir = obs?.wind.direction ? DIRS[obs.wind.direction] : undefined;
      const speed = obs?.wind.speed ?? 0;
      if (dir === undefined || !speed || !hasData) {
        n.vane.style.display = 'none';
      } else {
        // Point downwind: the arrow shows where the air is going.
        const { vane, vaneK } = layout.sizes;
        const rad = ((dir + 180 - 90) * Math.PI) / 180;
        const len = vane + Math.min(speed, 25) * vaneK;
        n.vane.style.display = '';
        n.vane.setAttribute('x2', (Math.cos(rad) * len).toFixed(1));
        n.vane.setAttribute('y2', (Math.sin(rad) * len).toFixed(1));
      }
      n.label.style.display = hasData ? '' : 'none';
    }
    if (selected !== null) showDetail(selected);
    // Label sizes depend on rendered glyph widths, so wait for the webfonts.
    document.fonts.ready.then(() => requestAnimationFrame(placeLabels));
  }

  function relayout(screen: HTMLElement) {
    const { width, height } = screen.getBoundingClientRect();
    if (!width || !height) return; // minimized
    const next = width / height >= 1.25 ? 'wide' : 'tall';
    if (next !== layout.key) {
      layout = layoutFor(next);
      applyLayout();
      paint();
    } else {
      requestAnimationFrame(placeLabels);
    }
  }

  return {
    intervalMs: 10 * 60 * 1000,
    mount(panelRoot, context) {
      ctx = context;
      panelRoot.innerHTML = '';
      nodes.length = 0;
      lamp = el('span', { class: 'status-lamp' });
      lampLabel = el('span', {}, '');
      stamp = el('span', { class: 'panel__footer-value' }, '--:--');
      detail = el('div', { class: 'map__detail', 'aria-live': 'polite' });
      const screen = el('div', { class: 'map__screen' }, buildMap());
      applyLayout();
      new ResizeObserver(() => relayout(screen)).observe(screen);

      const legend = el(
        'div',
        { class: 'map__legend' },
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--town' }), 'BYGGÐ'),
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--highland' }), 'HÁLENDI'),
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--live' }), 'VIRK'),
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--stale' }), 'GÖMUL GÖGN'),
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--vane' }), 'VINDUR'),
      );

      panelRoot.append(
        el(
          'header',
          { class: 'panel__header' },
          el('h2', { class: 'panel__title' }, 'KORT'),
          el('div', { class: 'panel__status' }, lamp, lampLabel),
        ),
        el('div', { class: 'panel__body panel__body--map' }, screen, detail),
        el(
          'footer',
          { class: 'panel__footer' },
          legend,
          el('span', { class: 'map__credit' }, 'STRANDLÍNA © OPENSTREETMAP'),
          el('span', { class: 'panel__footer-label map__footer-stamp' }, 'UPPFÆRT'),
          stamp,
        ),
      );
      showDetail(null);
    },
    async refresh() {
      try {
        const res = await getJson<MultiObs>(`${ctx.apiBase}/obs-multi?ids=${ALL_IDS.join(',')}`);
        data = new Map(res.stations.map((s) => [s.stationId, s]));
        paint();
        lamp.className = 'status-lamp status-lamp--on';
        lampLabel.textContent = '';
        stamp.textContent = fmtTime(res.fetchedAt);
      } catch {
        lamp.className = 'status-lamp status-lamp--alert';
        lampLabel.textContent = 'VILLA';
      }
    },
  };
}
