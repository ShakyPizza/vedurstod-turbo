import SunCalc from 'suncalc';
import type { Panel } from './types.ts';
import { el, svg } from './types.ts';

const PHASE_NAMES: Array<{ max: number; name: string }> = [
  { max: 0.03, name: 'Nýtt tungl' },
  { max: 0.22, name: 'Vaxandi sigð' },
  { max: 0.28, name: 'Fyrsta kvartil' },
  { max: 0.47, name: 'Vaxandi gleiður' },
  { max: 0.53, name: 'Fullt tungl' },
  { max: 0.72, name: 'Minnkandi gleiður' },
  { max: 0.78, name: 'Síðasta kvartil' },
  { max: 0.97, name: 'Minnkandi sigð' },
  { max: 1.01, name: 'Nýtt tungl' },
];

function phaseName(phase: number): string {
  for (const p of PHASE_NAMES) if (phase <= p.max) return p.name;
  return 'Tungl';
}

// Build an SVG path for the lit region of a moon of radius R at origin.
// k = illumination fraction (0..1), phase 0..1 (0 new, 0.5 full).
function moonLitPath(R: number, k: number, phase: number): string {
  const waxing = phase < 0.5;
  const outerSweep = waxing ? 1 : 0;
  const rxAbs = Math.abs((1 - 2 * k) * R);
  const termSweep = k <= 0.5 ? 1 - outerSweep : outerSweep;
  return `M 0,${-R} A ${R},${R} 0 0 ${outerSweep} 0,${R} A ${rxAbs},${R} 0 0 ${termSweep} 0,${-R} Z`;
}

function nextPhaseDate(from: Date, target: 0 | 0.5): Date {
  let best: Date | null = null;
  let bestDist = Infinity;
  const start = from.getTime();
  for (let h = 0; h <= 24 * 35; h++) {
    const t = new Date(start + h * 3600 * 1000);
    const p = SunCalc.getMoonIllumination(t).phase;
    const dist = target === 0 ? Math.min(p, 1 - p) : Math.abs(p - 0.5);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
    if (bestDist < 0.001) break;
  }
  return best!;
}

const DATE_FMT = new Intl.DateTimeFormat('is-IS', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

const TIME_FMT = new Intl.DateTimeFormat('is-IS', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

export function moonPanel(): Panel {
  let orbLit: SVGElement;
  let orbDisk: SVGElement;
  let nameEl: HTMLElement;
  let illumEl: HTMLElement;
  let nextNewEl: HTMLElement;
  let nextFullEl: HTMLElement;
  let riseEl: HTMLElement;
  let setEl: HTMLElement;
  let station = { lat: 64.1542, lon: -22.027 };
  const R = 95;

  return {
    intervalMs: 60 * 1000,
    mount(root, ctx) {
      station = { lat: ctx.station.lat, lon: ctx.station.lon };
      root.innerHTML = '';

      const header = el(
        'header',
        { class: 'panel__header' },
        el('h2', { class: 'panel__title' }, 'TUNGL'),
      );

      const body = el('div', { class: 'panel__body panel__body--moon' });

      const art = svg('svg', {
        viewBox: '-120 -120 240 240',
        class: 'moon-orb',
      });
      // Back glow halo
      art.append(
        svg('circle', {
          cx: 0,
          cy: 0,
          r: R + 12,
          class: 'moon-orb__halo',
        }),
      );
      // Dark (unlit) disk
      orbDisk = svg('circle', {
        cx: 0,
        cy: 0,
        r: R,
        class: 'moon-orb__disk',
      });
      art.append(orbDisk);
      // Lit portion
      orbLit = svg('path', {
        d: moonLitPath(R, 0, 0),
        class: 'moon-orb__lit',
      });
      art.append(orbLit);
      // Rim outline
      art.append(
        svg('circle', {
          cx: 0,
          cy: 0,
          r: R,
          class: 'moon-orb__rim',
        }),
      );

      const info = el('div', { class: 'moon__info' });
      nameEl = el('div', { class: 'moon__name' }, 'TUNGL');
      illumEl = el('div', { class: 'moon__illum' }, '— %');
      const stats = el('dl', { class: 'moon__stats' });
      nextNewEl = el('dd', {}, '—');
      nextFullEl = el('dd', {}, '—');
      riseEl = el('dd', {}, '—');
      setEl = el('dd', {}, '—');
      stats.append(
        el('dt', {}, 'NÆSTA NÝTT'),
        nextNewEl,
        el('dt', {}, 'NÆSTA FULLT'),
        nextFullEl,
        el('dt', {}, 'UPPKOMA'),
        riseEl,
        el('dt', {}, 'NIÐURKOMA'),
        setEl,
      );
      info.append(nameEl, illumEl, stats);

      body.append(el('div', { class: 'moon__art' }, art), info);
      root.append(header, body);
    },
    refresh() {
      const now = new Date();
      const illum = SunCalc.getMoonIllumination(now);
      orbLit.setAttribute('d', moonLitPath(R, illum.fraction, illum.phase));
      nameEl.textContent = phaseName(illum.phase).toUpperCase();
      illumEl.textContent = `${(illum.fraction * 100).toFixed(0)}% LÝST`;

      nextNewEl.textContent = DATE_FMT.format(nextPhaseDate(now, 0));
      nextFullEl.textContent = DATE_FMT.format(nextPhaseDate(now, 0.5));

      const times = SunCalc.getMoonTimes(now, station.lat, station.lon, true);
      riseEl.textContent = times.rise ? TIME_FMT.format(times.rise) : '—';
      setEl.textContent = times.set ? TIME_FMT.format(times.set) : '—';
    },
  };
}
