import type { Panel } from './types.ts';
import { el, getJson } from './types.ts';

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
  const cell = el('div', { class: 'forecast__cell' });
  cell.append(
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
