import type { Panel, PanelContext } from './types.ts';
import { el, svg, getJson } from './types.ts';
import { ICELAND_PATH, MAP_H, MAP_W, project } from './iceland-shape.ts';

/** Where the label sits relative to the lamp. */
type Anchor = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface MapStation {
  id: number;
  name: string;
  lat: number;
  lon: number;
  highland?: boolean;
  label: Anchor;
}

// Main towns around the coast, plus a few highland stations.
// The server only serves these IDs: keep in step with MAP_STATION_IDS in
// server/sources/obs.js.
const MAP_STATIONS: MapStation[] = [
  { id: 1, name: 'Reykjavík', lat: 64.127, lon: -21.902, label: 'e' },
  { id: 990, name: 'Keflavík', lat: 63.985, lon: -22.605, label: 'sw' },
  { id: 6300, name: 'Selfoss', lat: 63.933, lon: -21.0, label: 'se' },
  { id: 6015, name: 'Vestmannaeyjar', lat: 63.44, lon: -20.27, label: 's' },
  { id: 178, name: 'Stykkishólmur', lat: 65.073, lon: -22.733, label: 'e' },
  { id: 2319, name: 'Patreksfjörður', lat: 65.6, lon: -23.967, label: 's' },
  { id: 2644, name: 'Ísafjörður', lat: 66.067, lon: -23.133, label: 'e' },
  { id: 3317, name: 'Blönduós', lat: 65.667, lon: -20.3, label: 'sw' },
  { id: 3433, name: 'Sauðárkrókur', lat: 65.733, lon: -19.567, label: 'n' },
  { id: 3471, name: 'Akureyri', lat: 65.683, lon: -18.1, label: 's' },
  { id: 3696, name: 'Húsavík', lat: 66.043, lon: -17.34, label: 'e' },
  { id: 4828, name: 'Raufarhöfn', lat: 66.452, lon: -15.952, label: 'e' },
  { id: 571, name: 'Egilsstaðir', lat: 65.283, lon: -14.401, label: 'w' },
  { id: 5544, name: 'Höfn', lat: 64.267, lon: -15.2, label: 'e' },
  { id: 6272, name: 'Kirkjubæjarklaustur', lat: 63.783, lon: -18.05, label: 's' },
  { id: 6935, name: 'Hveravellir', lat: 64.873, lon: -19.553, highland: true, label: 'w' },
  { id: 6748, name: 'Setur', lat: 64.628, lon: -18.938, highland: true, label: 'e' },
  { id: 6670, name: 'Jökulheimar', lat: 64.31, lon: -18.237, highland: true, label: 'e' },
];

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

const LABEL_OFFSET: Record<Anchor, { dx: number; dy: number; anchor: string }> = {
  n: { dx: 0, dy: -20, anchor: 'middle' },
  s: { dx: 0, dy: 44, anchor: 'middle' },
  e: { dx: 18, dy: 10, anchor: 'start' },
  w: { dx: -18, dy: 10, anchor: 'end' },
  ne: { dx: 12, dy: -14, anchor: 'start' },
  nw: { dx: -12, dy: -14, anchor: 'end' },
  se: { dx: 12, dy: 40, anchor: 'start' },
  sw: { dx: -12, dy: 40, anchor: 'end' },
};

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

interface StationNode {
  def: MapStation;
  group: SVGElement;
  temp: SVGElement;
  vane: SVGElement;
  label: SVGElement;
  plate: SVGElement;
}

/** Fit the backing plate to the temperature and name it sits behind. */
function fitPlate(n: StationNode) {
  const texts = Array.from(n.label.querySelectorAll('text')) as SVGGraphicsElement[];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of texts) {
    const b = t.getBBox();
    if (!b.width) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  if (!Number.isFinite(x0)) return; // not rendered yet (minimized panel)
  const padX = 7, padY = 3;
  n.plate.setAttribute('x', (x0 - padX).toFixed(1));
  n.plate.setAttribute('y', (y0 - padY).toFixed(1));
  n.plate.setAttribute('width', (x1 - x0 + padX * 2).toFixed(1));
  n.plate.setAttribute('height', (y1 - y0 + padY * 2).toFixed(1));
}

export function mapPanel(): Panel {
  let ctx: PanelContext;
  let lamp: HTMLElement;
  let lampLabel: HTMLElement;
  let stamp: HTMLElement;
  let detail: HTMLElement;
  const nodes = new Map<number, StationNode>();
  let data = new Map<number, MultiObs['stations'][number]>();
  let selected: number | null = null;

  function showDetail(id: number | null) {
    selected = id;
    for (const [sid, n] of nodes) n.group.classList.toggle('map-stn--selected', sid === id);
    const def = MAP_STATIONS.find((s) => s.id === id);
    const obs = id !== null ? data.get(id) : undefined;
    if (!def) {
      detail.replaceChildren(
        el('span', { class: 'map__detail-hint' }, 'Veldu stöð á kortinu'),
      );
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
      el('span', { class: 'map__detail-name' }, def.name),
      cell('HITI', obs?.temperature != null ? obs.temperature.toFixed(1) : '—', '°C'),
      cell('VINDUR', w?.speed != null ? String(w.speed) : '—', 'm/s'),
      cell('ÁTT', w?.direction ?? '—'),
      cell('HVIÐA', w?.gust != null ? String(w.gust) : '—', 'm/s'),
      cell('MÆLT', fmtTime(obs?.observedAt ?? null)),
    );
  }

  function buildMap(): SVGElement {
    const pad = 24;
    const root = svg('svg', {
      viewBox: `${-pad} ${-pad} ${MAP_W + pad * 2} ${MAP_H + pad * 2}`,
      class: 'map-scope',
      role: 'img',
      'aria-label': 'Kort af Íslandi með veðurstöðvum',
      preserveAspectRatio: 'xMidYMid meet',
    });

    const defs = svg('defs');
    defs.append(
      svg(
        'filter',
        { id: 'map-bloom', x: '-50%', y: '-50%', width: '200%', height: '200%' },
        svg('feGaussianBlur', { stdDeviation: 3.5, result: 'b' }),
        svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })),
      ),
    );
    root.append(defs);

    // Graticule: 1° latitude, 2° longitude.
    const grid = svg('g', { class: 'map-grid' });
    for (let lat = 63.5; lat <= 66.5; lat += 0.5) {
      const [x0, y] = project(lat, -25);
      const [x1] = project(lat, -13);
      const major = Number.isInteger(lat);
      grid.append(svg('line', { x1: x0, y1: y, x2: x1, y2: y, class: major ? 'map-grid__major' : 'map-grid__minor' }));
      if (major) grid.append(svg('text', { x: -pad + 6, y: y - 5, class: 'map-grid__label' }, `${lat}°N`));
    }
    for (let lon = -24; lon <= -14; lon += 1) {
      const [x, y0] = project(67, lon);
      const [, y1] = project(63, lon);
      const major = lon % 2 === 0;
      grid.append(svg('line', { x1: x, y1: y0, x2: x, y2: y1, class: major ? 'map-grid__major' : 'map-grid__minor' }));
      if (major) grid.append(svg('text', { x: x + 5, y: MAP_H + pad - 8, class: 'map-grid__label' }, `${-lon}°V`));
    }
    root.append(grid);

    root.append(svg('path', { d: ICELAND_PATH, class: 'map-land__glow', filter: 'url(#map-bloom)' }));
    root.append(svg('path', { d: ICELAND_PATH, class: 'map-land' }));

    const layer = svg('g', { class: 'map-stations' });
    MAP_STATIONS.forEach((def, i) => {
      const [x, y] = project(def.lat, def.lon);
      const off = LABEL_OFFSET[def.label];
      const group = svg('g', {
        class: `map-stn${def.highland ? ' map-stn--highland' : ''}`,
        transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
        tabindex: 0,
        role: 'button',
        'aria-label': def.name,
        style: `--i:${i}`,
      });
      const vane = svg('line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'map-stn__vane' });
      const marker = def.highland
        ? svg('rect', { x: -6, y: -6, width: 12, height: 12, transform: 'rotate(45)', class: 'map-stn__lamp' })
        : svg('circle', { r: 6.5, class: 'map-stn__lamp' });
      const halo = svg('circle', { r: 16, class: 'map-stn__halo' });
      const ring = svg('circle', { r: 13, class: 'map-stn__ring' });
      const temp = svg('text', { x: off.dx, y: off.dy, 'text-anchor': off.anchor, class: 'map-stn__temp' }, '—');
      const name = svg(
        'text',
        { x: off.dx, y: off.dy + (off.dy < 0 ? -36 : 22), 'text-anchor': off.anchor, class: 'map-stn__name' },
        def.name.toUpperCase(),
      );
      const plate = svg('rect', { class: 'map-stn__plate', rx: 2 });
      const label = svg('g', { class: 'map-stn__label' }, plate, temp, name);
      group.append(halo, vane, ring, marker, label);
      const pick = () => showDetail(selected === def.id ? null : def.id);
      group.addEventListener('click', pick);
      group.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') {
          ev.preventDefault();
          pick();
        }
      });
      layer.append(group);
      nodes.set(def.id, { def, group, temp, vane, label, plate });
    });
    root.append(layer);

    // Mark the station of the active tab when it lies on the map.
    const [ax, ay] = project(ctx.station.lat, ctx.station.lon);
    root.append(
      svg('g', { class: 'map-home', transform: `translate(${ax.toFixed(1)} ${ay.toFixed(1)})` },
        svg('path', { d: 'M-20 0H-10M10 0H20M0 -20V-10M0 10V20', class: 'map-home__cross' }),
      ),
    );

    return root;
  }

  function paint() {
    for (const [id, n] of nodes) {
      const obs = data.get(id);
      const t = obs?.temperature ?? null;
      n.temp.textContent = fmtTemp(t);
      n.group.classList.toggle('map-stn--frost', t !== null && t < 0);
      n.group.classList.toggle('map-stn--nodata', !obs || t === null);
      const dir = obs?.wind.direction ? DIRS[obs.wind.direction] : undefined;
      const speed = obs?.wind.speed ?? 0;
      if (dir === undefined || !speed) {
        n.vane.setAttribute('x2', '0');
        n.vane.setAttribute('y2', '0');
      } else {
        // Point downwind: the vane shows where the air is going.
        const rad = ((dir + 180 - 90) * Math.PI) / 180;
        const len = 10 + Math.min(speed, 25) * 1.6;
        n.vane.setAttribute('x2', (Math.cos(rad) * len).toFixed(1));
        n.vane.setAttribute('y2', (Math.sin(rad) * len).toFixed(1));
      }
    }
    if (selected !== null) showDetail(selected);
    // Plates depend on rendered glyph widths, so wait for the webfonts.
    document.fonts.ready.then(() => requestAnimationFrame(() => nodes.forEach(fitPlate)));
  }

  return {
    intervalMs: 10 * 60 * 1000,
    mount(root, context) {
      ctx = context;
      root.innerHTML = '';
      lamp = el('span', { class: 'status-lamp' });
      lampLabel = el('span', {}, '');
      stamp = el('span', { class: 'panel__footer-value' }, '--:--');
      detail = el('div', { class: 'map__detail', 'aria-live': 'polite' });
      const screen = el('div', { class: 'map__screen' }, buildMap());
      // Refit label plates when the panel is restored from minimized.
      new ResizeObserver(() => nodes.forEach(fitPlate)).observe(screen);

      const legend = el(
        'div',
        { class: 'map__legend' },
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--town' }), 'BYGGÐ'),
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--highland' }), 'HÁLENDI'),
        el('span', { class: 'map__legend-item' }, el('i', { class: 'map__key map__key--vane' }), 'VINDSTEFNA'),
      );

      root.append(
        el(
          'header',
          { class: 'panel__header' },
          el('h2', { class: 'panel__title' }, 'KORT'),
          el('div', { class: 'panel__status' }, lamp, lampLabel),
        ),
        el(
          'div',
          { class: 'panel__body panel__body--map' },
          screen,
          detail,
        ),
        el(
          'footer',
          { class: 'panel__footer' },
          legend,
          el('span', { class: 'panel__footer-label map__footer-stamp' }, 'UPPFÆRT'),
          stamp,
        ),
      );
      showDetail(null);
    },
    async refresh() {
      try {
        const ids = MAP_STATIONS.map((s) => s.id).join(',');
        const res = await getJson<MultiObs>(`${ctx.apiBase}/obs-multi?ids=${ids}`);
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
