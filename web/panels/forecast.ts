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
    '..X..',
    '.XXX.',
    'XXXXX',
    '.XXX.',
    '..X..',
  ],
  partly: [
    'X....',
    '.X...',
    '..XX.',
    '.XXXX',
    '.XXXX',
  ],
  cloudy: [
    '..XX.',
    '.XXXX',
    'XXXXX',
    'XXXXX',
    '.....',
  ],
  overcast: [
    '.XXX.',
    'XXXXX',
    'XXXXX',
    'XXXXX',
    '.XXX.',
  ],
  fog: [
    'XXXXX',
    '.....',
    'XXXXX',
    '.....',
    'XXXXX',
  ],
  rain: [
    '.XXX.',
    'XXXXX',
    '.....',
    '.X.X.',
    'X.X.X',
  ],
  snow: [
    '.XXX.',
    'XXXXX',
    '.....',
    'X.X.X',
    '.X.X.',
  ],
  sleet: [
    '.XXX.',
    'XXXXX',
    '.....',
    'X.X.X',
    '.XXX.',
  ],
  thunder: [
    '.XXX.',
    'XXXXX',
    '..X..',
    '.X...',
    'X....',
  ],
  unknown: [
    '.....',
    '..X..',
    '.....',
    '..X..',
    '.....',
  ],
};

function buildSkySymbol(sky: Sky): SVGElement {
  const root = svg('svg', {
    viewBox: '0 0 30 30',
    class: `sky-symbol sky-symbol--${sky}`,
  });
  root.append(svg('rect', { x: 0, y: 0, width: 30, height: 30, class: 'sky-symbol__bg' }));
  const pattern = PATTERNS[sky];
  const cell = 5;
  const offset = 2.5;
  const r = 1.7;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const on = pattern[y][x] === 'X';
      root.append(
        svg('circle', {
          cx: offset + x * cell + cell / 2,
          cy: offset + y * cell + cell / 2,
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
  let apiBase = '/api';

  return {
    intervalMs: 60 * 60 * 1000,
    mount(el_root, ctx) {
      apiBase = ctx.apiBase;
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
        const data = await getJson<Forecast>(`${apiBase}/forecast`);
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
