import SunCalc from 'suncalc';
import type { Panel } from './types.ts';
import { el } from './types.ts';

// Approximate lunitidal interval (Reykjavík ≈ +4h 30m). Used station-wide
// since Veðurstofan does not publish a tide API; this is an astronomical
// approximation against the principal lunar (M2) component, accurate to
// roughly 15–30 minutes for Iceland's coast.
const LUNITIDAL_HOURS = 4.5;
const STEP_MS = 5 * 60 * 1000;
const LOOKAHEAD_HOURS = 30;

interface Tide {
  type: 'high' | 'low';
  time: Date;
}

function findMoonTransits(now: Date, lat: number, lon: number): Date[] {
  const transits: Date[] = [];
  let prevAlt = SunCalc.getMoonPosition(new Date(now.getTime() - STEP_MS), lat, lon).altitude;
  let curAlt = SunCalc.getMoonPosition(now, lat, lon).altitude;
  const end = now.getTime() + LOOKAHEAD_HOURS * 3600 * 1000;
  for (let t = now.getTime() + STEP_MS; t <= end; t += STEP_MS) {
    const nextAlt = SunCalc.getMoonPosition(new Date(t), lat, lon).altitude;
    // Local extremum (upper or lower transit). Both produce a tide bulge.
    if ((curAlt > prevAlt && curAlt > nextAlt) || (curAlt < prevAlt && curAlt < nextAlt)) {
      // Refine by parabolic interpolation around the three samples.
      const denom = prevAlt - 2 * curAlt + nextAlt;
      const offset = denom !== 0 ? (0.5 * (prevAlt - nextAlt)) / denom : 0;
      transits.push(new Date(t - STEP_MS + offset * STEP_MS));
    }
    prevAlt = curAlt;
    curAlt = nextAlt;
  }
  return transits;
}

function predictTides(now: Date, lat: number, lon: number): Tide[] {
  const transits = findMoonTransits(now, lat, lon);
  const highs: Tide[] = transits.map((t) => ({
    type: 'high',
    time: new Date(t.getTime() + LUNITIDAL_HOURS * 3600 * 1000),
  }));
  const tides: Tide[] = [...highs];
  for (let i = 0; i < highs.length - 1; i++) {
    const mid = (highs[i].time.getTime() + highs[i + 1].time.getTime()) / 2;
    tides.push({ type: 'low', time: new Date(mid) });
  }
  tides.sort((a, b) => a.time.getTime() - b.time.getTime());
  return tides.filter((t) => t.time.getTime() > now.getTime());
}

const TIME_FMT = new Intl.DateTimeFormat('is-IS', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

function countdownText(from: Date, to: Date): string {
  const diff = Math.max(0, to.getTime() - from.getTime());
  const totalMin = Math.floor(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}st ${m.toString().padStart(2, '0')}m`;
}

export function tidesPanel(): Panel {
  let station = { lat: 64.1542, lon: -22.027 };
  let stateLabel: HTMLElement;
  let stateLamp: HTMLElement;
  let nextHighCount: HTMLElement;
  let nextHighTime: HTMLElement;
  let nextLowCount: HTMLElement;
  let nextLowTime: HTMLElement;

  return {
    intervalMs: 60 * 1000,
    mount(root, ctx) {
      station = { lat: ctx.station.lat, lon: ctx.station.lon };
      root.innerHTML = '';
      root.classList.remove('panel--placeholder');

      stateLamp = el('span', { class: 'status-lamp' });
      stateLabel = el('span', {}, '—');

      const header = el(
        'header',
        { class: 'panel__header' },
        el('h2', { class: 'panel__title' }, 'SJÁVARFÖLL'),
        el(
          'div',
          { class: 'panel__status' },
          stateLamp,
          stateLabel,
        ),
      );

      nextHighCount = el('span', { class: 'tides__count' }, '—');
      nextHighTime = el('span', { class: 'tides__stamp' }, '—:—');
      nextLowCount = el('span', { class: 'tides__count' }, '—');
      nextLowTime = el('span', { class: 'tides__stamp' }, '—:—');

      const body = el(
        'div',
        { class: 'panel__body panel__body--tides' },
        el(
          'div',
          { class: 'tides__cell' },
          el('div', { class: 'tides__cell-label' }, 'NÆSTA HÁFLÆÐI'),
          nextHighCount,
          nextHighTime,
        ),
        el(
          'div',
          { class: 'tides__cell' },
          el('div', { class: 'tides__cell-label' }, 'NÆSTA FJARA'),
          nextLowCount,
          nextLowTime,
        ),
      );

      const footer = el(
        'footer',
        { class: 'panel__footer' },
        el('span', { class: 'panel__footer-label' }, 'AÐFERÐ'),
        el('span', { class: 'panel__footer-value' }, 'TUNGLLÍKAN'),
      );

      root.append(header, body, footer);
    },
    refresh() {
      const now = new Date();
      const tides = predictTides(now, station.lat, station.lon);
      const nextHigh = tides.find((t) => t.type === 'high');
      const nextLow = tides.find((t) => t.type === 'low');
      const next = tides[0];

      if (next) {
        const rising = next.type === 'high';
        stateLabel.textContent = rising ? 'AÐFALL' : 'ÚTFALL';
        stateLamp.className = `status-lamp ${rising ? 'status-lamp--on' : 'status-lamp--alert'}`;
      } else {
        stateLabel.textContent = '—';
        stateLamp.className = 'status-lamp';
      }

      if (nextHigh) {
        nextHighCount.textContent = countdownText(now, nextHigh.time);
        nextHighTime.textContent = TIME_FMT.format(nextHigh.time);
      }
      if (nextLow) {
        nextLowCount.textContent = countdownText(now, nextLow.time);
        nextLowTime.textContent = TIME_FMT.format(nextLow.time);
      }
    },
  };
}
