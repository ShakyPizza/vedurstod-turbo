import type { Panel } from './types.ts';
import { el, getJson } from './types.ts';

interface Quake {
  id: string;
  lat: number;
  lon: number;
  time: string;
  magnitude: number;
  depth: number;
  place: string | null;
}

interface QuakesResponse {
  fetchedAt: string;
  quakes: Quake[];
}

const TIME_FMT = new Intl.DateTimeFormat('is-IS', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

const NEW_QUAKE_BLINK_MS = 10 * 60 * 1000;

function quakeTime(q: Quake): number {
  const t = new Date(q.time).getTime();
  return Number.isFinite(t) ? t : 0;
}

function timeAgo(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, now.getTime() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'núna';
  if (m < 60) return `${m} mín`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} klst`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function magClass(mag: number): string {
  if (mag > 4) return 'quake-row--strong';
  if (mag > 3) return 'quake-row--amber';
  if (mag > 2) return 'quake-row--moderate';
  return 'quake-row--minor';
}

function renderRow(q: Quake, now: Date, seenAt: number): HTMLElement {
  const isNew = now.getTime() - seenAt < NEW_QUAKE_BLINK_MS;
  return el(
    'div',
    { class: `quake-row ${magClass(q.magnitude)}${isNew ? ' quake-row--new' : ''}` },
    el(
      'span',
      { class: 'quake-row__mag' },
      Number.isFinite(q.magnitude) ? q.magnitude.toFixed(1) : '—',
    ),
    el(
      'div',
      { class: 'quake-row__main' },
      el('div', { class: 'quake-row__place' }, q.place ?? '—'),
      el(
        'div',
        { class: 'quake-row__sub' },
        `${TIME_FMT.format(new Date(q.time))} · ${timeAgo(q.time, now)} · ${
          Number.isFinite(q.depth) ? `${q.depth.toFixed(1)} km` : '—'
        }`,
      ),
    ),
  );
}

export function quakesPanel(): Panel {
  let body: HTMLElement;
  let footerCount: HTMLElement;
  let footerStamp: HTMLElement;
  const firstSeen = new Map<string, number>();
  let hasLoaded = false;

  return {
    intervalMs: 60 * 1000,
    mount(root) {
      root.innerHTML = '';
      root.classList.remove('panel--placeholder');

      const header = el(
        'header',
        { class: 'panel__header' },
        el('h2', { class: 'panel__title' }, 'SKJÁLFTAR'),
        el(
          'div',
          { class: 'panel__status' },
          el('span', {}, '48 KLST'),
        ),
      );

      body = el('div', { class: 'panel__body panel__body--quakes' });

      footerCount = el('span', { class: 'panel__footer-value' }, '—');
      footerStamp = el('span', { class: 'panel__footer-value' }, '—');
      const footer = el(
        'footer',
        { class: 'panel__footer' },
        el('span', { class: 'panel__footer-label' }, 'FJÖLDI'),
        footerCount,
        el('span', { class: 'panel__footer-sep' }, '·'),
        el('span', { class: 'panel__footer-label' }, 'SÓTT'),
        footerStamp,
      );

      root.append(header, body, footer);
    },
    async refresh() {
      try {
        const data = await getJson<QuakesResponse>('/api/quakes');
        const now = new Date();
        const quakes = (data.quakes ?? []).filter(
          (q) => Number.isFinite(q.magnitude) && q.magnitude >= 1,
        );

        const visibleIds = new Set<string>();
        for (const q of quakes) {
          visibleIds.add(q.id);
          if (!firstSeen.has(q.id)) {
            firstSeen.set(q.id, hasLoaded ? now.getTime() : quakeTime(q));
          }
        }
        for (const [id, seenAt] of firstSeen) {
          if (!visibleIds.has(id) && now.getTime() - seenAt >= NEW_QUAKE_BLINK_MS) {
            firstSeen.delete(id);
          }
        }

        const featured = quakes
          .filter((q) => q.magnitude >= 3)
          .sort((a, b) => quakeTime(b) - quakeTime(a))[0];

        const recent = quakes
          .filter((q) => !featured || q.id !== featured.id)
          .slice(0, 16);

        body.innerHTML = '';

        if (featured) {
          body.append(
            el(
              'div',
              { class: 'quake-featured' },
              el('div', { class: 'quake-featured__label' }, 'NÝJASTI ≥ M3.0'),
              renderRow(featured, now, firstSeen.get(featured.id) ?? quakeTime(featured)),
            ),
          );
        }

        body.append(
          el(
            'div',
            { class: 'quake-list' },
            el('div', { class: 'quake-list__label' }, 'NÝLEGIR SKJÁLFTAR'),
            ...(recent.length === 0
              ? [el('p', { class: 'quake-list__empty' }, 'Engir skjálftar á síðustu 48 klst.')]
              : recent.map((q) => renderRow(q, now, firstSeen.get(q.id) ?? quakeTime(q)))),
          ),
        );

        footerCount.textContent = String(quakes.length);
        footerStamp.textContent = TIME_FMT.format(new Date(data.fetchedAt));
        hasLoaded = true;
      } catch (err) {
        console.error('quakes refresh failed', err);
        body.innerHTML = '';
        body.append(el('p', { class: 'quake-list__empty' }, 'Gögn ekki tiltæk.'));
      }
    },
  };
}
