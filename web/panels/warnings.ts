import type { Panel } from './types.ts';
import { el, getJson } from './types.ts';

interface Warning {
  id: string;
  severity: string | null;
  color: string | null;
  type: string | null;
  event: string | null;
  headline: string | null;
  description: string | null;
  onset: string | null;
  expires: string | null;
  areas: string[];
  coversStation: boolean;
}

interface WarningsResponse {
  fetchedAt: string;
  updatedAt: string | null;
  nearby: Warning[];
  other: Warning[];
}

const TIME_FMT = new Intl.DateTimeFormat('is-IS', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

// Veðurstofan's CAP feed sends `eventCode.alertType` in English even in the
// Icelandic info block. Keys are lower-cased. Only Wind and Snow storm have
// been seen in the live feed; the rest are guesses at what IMO may send.
const ALERT_TYPE_IS: Record<string, string> = {
  'wind': 'Vindur',
  'snow storm': 'Snjóstormur',
  'snowstorm': 'Snjóstormur',
  'rain': 'Rigning',
  'heavy rain': 'Mikil rigning',
  'snow': 'Snjókoma',
  'heavy snow': 'Mikil snjókoma',
  'blowing snow': 'Skafrenningur',
  'freezing rain': 'Frostrigning',
  'ice': 'Ísing',
  'icing': 'Ísing',
  'thunderstorm': 'Þrumuveður',
  'fog': 'Þoka',
  'heat': 'Hiti',
  'cold': 'Kuldi',
  'sandstorm': 'Sandstormur',
  'dust storm': 'Moldrok',
  'avalanche': 'Snjóflóð',
  'flood': 'Flóð',
  'coastal flood': 'Sjávarflóð',
  'high waves': 'Ölduhæð',
};

// CAP 1.2 severity enum → Icelandic (shown under ALVARLEIKI).
const SEVERITY_IS: Record<string, string> = {
  extreme: 'Afar mikill',
  severe: 'Mikill',
  moderate: 'Talsverður',
  minor: 'Lítill',
  unknown: 'Óþekktur',
};

function typeLabel(w: Warning): string {
  const key = (w.type ?? '').trim().toLowerCase();
  if (key && ALERT_TYPE_IS[key]) return ALERT_TYPE_IS[key];
  // Fallback: the Icelandic `event` field, e.g. "Veðurviðvörun: Hríð".
  const ev = (w.event ?? '').replace(/^Veðurviðvörun:\s*/i, '').trim();
  if (ev) return ev;
  return 'Viðvörun';
}

function severityLabel(w: Warning): string {
  const key = (w.severity ?? '').trim().toLowerCase();
  if (!key) return '—';
  return SEVERITY_IS[key] ?? w.severity!;
}

function colorClass(w: Warning): string {
  const c = (w.color ?? '').toLowerCase();
  if (c === 'red') return 'lamp--red';
  if (c === 'orange') return 'lamp--orange';
  if (c === 'yellow') return 'lamp--yellow';
  return 'lamp--neutral';
}

function buildLamp(w: Warning, near: boolean): HTMLElement {
  const lamp = el(
    'button',
    { class: 'lamp ' + colorClass(w) + (near ? ' lamp--near' : ''), type: 'button' },
    el('span', { class: 'lamp__bulb' }),
    el(
      'span',
      { class: 'lamp__body' },
      el('span', { class: 'lamp__type' }, typeLabel(w)),
      el('span', { class: 'lamp__headline' }, w.headline ?? ''),
      el('span', { class: 'lamp__areas' }, w.areas.join(' · ')),
    ),
  );
  lamp.addEventListener('click', () => {
    const existing = lamp.nextElementSibling;
    if (existing && existing.classList.contains('lamp__detail')) {
      existing.remove();
      return;
    }
    const detail = el(
      'div',
      { class: 'lamp__detail' },
      el('p', { class: 'lamp__description' }, w.description ?? ''),
      el(
        'dl',
        { class: 'lamp__meta' },
        el('dt', {}, 'GILDIR FRÁ'),
        el('dd', {}, w.onset ? TIME_FMT.format(new Date(w.onset)) : '—'),
        el('dt', {}, 'RENNUR ÚT'),
        el('dd', {}, w.expires ? TIME_FMT.format(new Date(w.expires)) : '—'),
        el('dt', {}, 'ALVARLEIKI'),
        el('dd', {}, severityLabel(w)),
        el('dt', {}, 'SVÆÐI'),
        el('dd', {}, w.areas.join(', ') || '—'),
      ),
    );
    lamp.after(detail);
  });
  return lamp;
}

export function warningsPanel(): Panel {
  let root: HTMLElement;
  let nearBody: HTMLElement;
  let otherBody: HTMLElement;
  let countLabel: HTMLElement;
  let masterLamp: HTMLElement;
  let warningsUrl = '/api/warnings';

  return {
    intervalMs: 5 * 60 * 1000,
    mount(el_root, ctx) {
      warningsUrl = ctx.apiUrl('warnings');
      root = el_root;
      root.innerHTML = '';

      const header = el('header', { class: 'panel__header' });
      masterLamp = el('span', { class: 'status-lamp status-lamp--large' });
      header.append(
        el('h2', { class: 'panel__title' }, 'VIÐVARANIR'),
        el('div', { class: 'panel__status' }, masterLamp, document.createTextNode('Í GILDI')),
      );

      const body = el('div', { class: 'panel__body panel__body--warnings' });
      nearBody = el('div', { class: 'warnings__near' });
      otherBody = el('div', { class: 'warnings__other' });
      body.append(
        el('h3', { class: 'warnings__subheader' }, 'NÁGRENNI STÖÐVAR'),
        nearBody,
        el('h3', { class: 'warnings__subheader' }, 'AÐRAR VIÐVARANIR Á LANDINU'),
        otherBody,
      );

      countLabel = el('span', { class: 'panel__footer-value' }, '0');
      const footer = el(
        'footer',
        { class: 'panel__footer' },
        el('span', { class: 'panel__footer-label' }, 'FJÖLDI VIRKRA'),
        countLabel,
      );

      root.append(header, body, footer);
    },
    async refresh() {
      try {
        const data = await getJson<WarningsResponse>(warningsUrl);
        const total = data.nearby.length + data.other.length;
        countLabel.textContent = String(total);

        masterLamp.classList.remove('status-lamp--on', 'status-lamp--alert');
        if (data.nearby.length > 0) masterLamp.classList.add('status-lamp--alert');
        else if (total > 0) masterLamp.classList.add('status-lamp--on');

        nearBody.innerHTML = '';
        if (data.nearby.length === 0) {
          nearBody.append(el('p', { class: 'warnings__empty' }, 'Engar viðvaranir í nágrenni.'));
        } else {
          for (const w of data.nearby) nearBody.append(buildLamp(w, true));
        }

        otherBody.innerHTML = '';
        if (data.other.length === 0) {
          otherBody.append(el('p', { class: 'warnings__empty' }, 'Engar aðrar viðvaranir.'));
        } else {
          for (const w of data.other) otherBody.append(buildLamp(w, false));
        }
      } catch (err) {
        console.warn('warnings refresh failed', err);
        masterLamp.classList.remove('status-lamp--on');
        masterLamp.classList.add('status-lamp--alert');
      }
    },
  };
}
