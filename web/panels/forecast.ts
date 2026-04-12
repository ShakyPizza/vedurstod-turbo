import type { Panel } from './types.ts';
import { el, svg, getJson } from './types.ts';

type Sky =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'sleet'
  | 'thunder'
  | 'unknown';

function classifySky(state: string | null): Sky {
  const s = (state ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('þrum')) return 'thunder';
  if (s.includes('slydd')) return 'sleet';
  if (s.includes('snjó') || /\bél\b/.test(s) || s.includes('éljag')) return 'snow';
  if (s.includes('rign') || s.includes('skúr') || s.includes('súld') || s.includes('dropar'))
    return 'rain';
  if (s.includes('þoka') || s.includes('þoku') || s.includes('mistur') || s.includes('móða'))
    return 'fog';
  if (s.includes('heiðskírt') || s.includes('heiðrík')) return 'clear';
  if (s.includes('alskýjað') || s.includes('yfirskýj')) return 'overcast';
  if (s.includes('léttský') || s.includes('hálfský')) return 'partly';
  if (s.includes('skýjað') || s.includes('skýja')) return 'cloudy';
  return 'unknown';
}

const SKY_LABEL: Record<Sky, string> = {
  clear: 'HEIÐSKÍRT',
  partly: 'LÉTTSKÝJAÐ',
  cloudy: 'SKÝJAÐ',
  overcast: 'ALSKÝJAÐ',
  fog: 'ÞOKA',
  rain: 'RIGNING',
  snow: 'SNJÓR',
  sleet: 'SLYDDA',
  thunder: 'ÞRUMUR',
  unknown: '—',
};

const PATTERNS: Record<Sky, string[]> = {
  clear: [
    '.....X.....',
    '...........',
    '..X..X..X..',
    '....XXX....',
    '...XXXXX...',
    'X..XXXXX..X',
    '...XXXXX...',
    '....XXX....',
    '..X..X..X..',
    '...........',
    '.....X.....',
  ],
  partly: [
    '..X........',
    '.XXX.......',
    'XXXXX......',
    '.XXX.......',
    '..X...XX...',
    '.....XXXX..',
    '....XXXXXX.',
    '...XXXXXXXX',
    '..XXXXXXXXX',
    '..XXXXXXXXX',
    '...........',
  ],
  cloudy: [
    '...........',
    '.....XX....',
    '....XXXX...',
    '...XXXXXX..',
    '..XXXXXXXX.',
    '.XXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '...........',
  ],
  overcast: [
    '...XXXXXX..',
    '.XXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
  ],
  fog: [
    '...........',
    '.XXXXXXXXX.',
    '...........',
    'XXXXXXXXXXX',
    '...........',
    '.XXXXXXXXX.',
    '...........',
    'XXXXXXXXXXX',
    '...........',
    '.XXXXXXXXX.',
    '...........',
  ],
  rain: [
    '...XXXXX...',
    '..XXXXXXX..',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '...........',
    'X...X...X..',
    'X...X...X..',
    '.X...X...X.',
    '.X...X...X.',
    '..X...X...X',
  ],
  snow: [
    '...XXXXX...',
    '..XXXXXXX..',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '...........',
    '.X...X...X.',
    'XXX.XXX.XXX',
    '.X...X...X.',
    '...........',
    '.X...X...X.',
  ],
  sleet: [
    '...XXXXX...',
    '..XXXXXXX..',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '...........',
    '.X...X...X.',
    'XXX.XXX.XXX',
    '.X...X...X.',
    'X...X...X..',
    '.X...X...X.',
  ],
  thunder: [
    '...XXXXX...',
    '..XXXXXXX..',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '...........',
    '......X....',
    '.....XX....',
    '....XX.....',
    '...XXXX....',
    '.....XX....',
  ],
  unknown: [
    '...........',
    '...XXXXX...',
    '..XX...XX..',
    '.......XX..',
    '......XX...',
    '.....XX....',
    '.....XX....',
    '...........',
    '.....XX....',
    '.....XX....',
    '...........',
  ],
};

const GRID = 11;

function buildSkySymbol(sky: Sky): SVGElement {
  const size = GRID * 3;
  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: `sky-symbol sky-symbol--${sky}`,
  });
  root.append(svg('rect', { x: 0, y: 0, width: size, height: size, class: 'sky-symbol__bg' }));
  const pattern = PATTERNS[sky];
  const cell = 3;
  const r = 1.2;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const on = pattern[y][x] === 'X';
      root.append(
        svg('circle', {
          cx: x * cell + cell / 2,
          cy: y * cell + cell / 2,
          r,
          class: on ? 'sky-symbol__dot sky-symbol__dot--on' : 'sky-symbol__dot',
        }),
      );
    }
  }
  return root;
}

interface ForecastStep {
  time: string | null;
  temperature: number | null;
  windSpeed: number | null;
  windDirection: string | null;
  state: string | null;
}

interface Forecast {
  issuedAt: string | null;
  steps: ForecastStep[];
}

const HOUR_FMT = new Intl.DateTimeFormat('is-IS', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

const DAY_FMT = new Intl.DateTimeFormat('is-IS', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Atlantic/Reykjavik',
});

function groupByDay(steps: ForecastStep[]): Map<string, ForecastStep[]> {
  const out = new Map<string, ForecastStep[]>();
  for (const s of steps) {
    if (!s.time) continue;
    const key = s.time.slice(0, 10);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(s);
  }
  return out;
}

function buildStep(step: ForecastStep): HTMLElement {
  const sky = classifySky(step.state);
  const skyBox = el(
    'div',
    { class: `forecast__sky forecast__sky--${sky}`, title: SKY_LABEL[sky] },
    buildSkySymbol(sky),
  );
  const cell = el('div', { class: 'forecast__cell' });
  cell.append(
    skyBox,
    el('span', { class: 'forecast__time' }, step.time ? HOUR_FMT.format(new Date(step.time)) : '—'),
    el(
      'span',
      { class: 'forecast__temp' },
      step.temperature !== null ? `${step.temperature.toFixed(0)}°` : '—',
    ),
    el(
      'span',
      { class: 'forecast__wind' },
      `${step.windDirection ?? ''} ${step.windSpeed !== null ? step.windSpeed.toFixed(0) : '—'}`,
    ),
    el('span', { class: 'forecast__state' }, step.state ?? ''),
  );
  return cell;
}

function buildDay(day: string, steps: ForecastStep[]): HTMLElement {
  const header = el(
    'header',
    { class: 'forecast__day-header' },
    el('span', { class: 'forecast__day-label' }, DAY_FMT.format(new Date(day + 'T12:00:00Z'))),
  );
  const strip = el('div', { class: 'forecast__strip' });
  for (const s of steps) strip.append(buildStep(s));
  return el('section', { class: 'forecast__day' }, header, strip);
}

export function forecastPanel(): Panel {
  let root: HTMLElement;
  let body: HTMLElement;
  let statusLamp: HTMLElement;
  let issuedLabel: HTMLElement;
  let forecastUrl = '/api/forecast';

  return {
    intervalMs: 60 * 60 * 1000,
    mount(el_root, ctx) {
      forecastUrl = ctx.apiUrl('forecast');
      root = el_root;
      root.innerHTML = '';

      const header = el('header', { class: 'panel__header' }, el('h2', { class: 'panel__title' }, 'SPÁ'));
      const status = el('div', { class: 'panel__status' });
      statusLamp = el('span', { class: 'status-lamp' });
      status.append(statusLamp, document.createTextNode(' STRAUMUR'));
      header.append(status);

      body = el('div', { class: 'panel__body panel__body--forecast' });
      issuedLabel = el('span', { class: 'panel__footer-value' }, '—');
      const footer = el(
        'footer',
        { class: 'panel__footer' },
        el('span', { class: 'panel__footer-label' }, 'GEFIN ÚT'),
        issuedLabel,
      );
      root.append(header, body, footer);
    },
    async refresh() {
      try {
        const data = await getJson<Forecast>(forecastUrl);
        statusLamp.classList.add('status-lamp--on');
        statusLamp.classList.remove('status-lamp--alert');

        body.innerHTML = '';
        const now = Date.now();
        const future = data.steps.filter((s) => s.time && new Date(s.time).getTime() >= now - 60 * 60 * 1000);
        const days = groupByDay(future);
        let count = 0;
        for (const [day, steps] of days) {
          body.append(buildDay(day, steps));
          if (++count >= 7) break;
        }

        if (data.issuedAt) {
          issuedLabel.textContent = HOUR_FMT.format(new Date(data.issuedAt));
        }
      } catch (err) {
        console.warn('forecast refresh failed', err);
        statusLamp.classList.remove('status-lamp--on');
        statusLamp.classList.add('status-lamp--alert');
      }
    },
  };
}
