import type { Panel } from './types.ts';
import { el, svg, getJson } from './types.ts';

interface Obs {
  stationName: string;
  observedAt: string | null;
  temperature: number | null;
  dewPoint: number | null;
  humidity: number | null;
  pressure: number | null;
  wind: {
    speed: number | null;
    gust: number | null;
    max: number | null;
    direction: string | null;
  };
}

interface Textaspa {
  title: string;
  createdAt: string | null;
  paragraphs: string[];
}

// Shown when vedur.is publishes no hugleiðingar — gives the empty
// screen something to say in the spirit of the meteorologist's column.
const TEXTASPA_FALLBACKS = [
  'Veðurfræðingur er að fylgjast með málningu þorna og hefur ekki tíma til hugleiðslu.',
  'Veðurfræðingur heyrir grasið vaxa en hefur ekki leitt hugann að veðri í dag.',
  'Yfir landinu er hæð lengst uppi og veðurfræðingur kúrir þar með henni.',
  'Fullkomin áttleysa í dag, drengur. Veðurfræðingur hefur ekki leitt hugann að veðrinu vegna heyanna.',
  'Brakandi þurrkur og allir úti á túni. Veðurfræðingur hefur ekki leitt hugann að veðri í dag vegna heyanna.',
  'Vinsamlegast dokið við, veðurfræðingur er að hugleiða í þessum rituðu orðum. Ef ekkert heyrist frá honum fyrir kaffi má hringja á björgunarsveit.',
];

const DIRS: Record<string, number> = {
  N: 0,
  NNA: 22.5,
  NA: 45,
  ANA: 67.5,
  A: 90,
  ASA: 112.5,
  SA: 135,
  SSA: 157.5,
  S: 180,
  SSV: 202.5,
  SV: 225,
  VSV: 247.5,
  V: 270,
  VNV: 292.5,
  NV: 315,
  NNV: 337.5,
};

const CARDINAL = [
  { deg: 0, label: 'N' },
  { deg: 45, label: 'NA' },
  { deg: 90, label: 'A' },
  { deg: 135, label: 'SA' },
  { deg: 180, label: 'S' },
  { deg: 225, label: 'SV' },
  { deg: 270, label: 'V' },
  { deg: 315, label: 'NV' },
];

function fmt(value: number | null, digits = 0, suffix = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits) + suffix;
}

function buildGauge(): { root: SVGElement; needle: SVGElement; gustNeedle: SVGElement; speedText: SVGElement; gustText: SVGElement } {
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const r = 128;
  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'wind-gauge',
    xmlns: 'http://www.w3.org/2000/svg',
  });

  // Outer bezel
  root.append(svg('circle', { cx, cy, r: r + 14, class: 'wind-gauge__bezel-outer' }));
  root.append(svg('circle', { cx, cy, r: r + 6, class: 'wind-gauge__bezel-inner' }));
  root.append(svg('circle', { cx, cy, r, class: 'wind-gauge__dial' }));

  // Tick marks every 10 degrees
  for (let d = 0; d < 360; d += 10) {
    const isMajor = d % 30 === 0;
    const isCardinal = d % 45 === 0;
    const length = isCardinal ? 16 : isMajor ? 12 : 6;
    const rad = ((d - 90) * Math.PI) / 180;
    const x1 = cx + Math.cos(rad) * (r - length);
    const y1 = cy + Math.sin(rad) * (r - length);
    const x2 = cx + Math.cos(rad) * r;
    const y2 = cy + Math.sin(rad) * r;
    root.append(
      svg('line', {
        x1,
        y1,
        x2,
        y2,
        class: isCardinal
          ? 'wind-gauge__tick wind-gauge__tick--cardinal'
          : isMajor
            ? 'wind-gauge__tick wind-gauge__tick--major'
            : 'wind-gauge__tick',
      }),
    );
  }

  // Cardinal labels
  for (const { deg, label } of CARDINAL) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const tr = r - 30;
    const x = cx + Math.cos(rad) * tr;
    const y = cy + Math.sin(rad) * tr;
    const t = svg(
      'text',
      {
        x,
        y,
        class: deg % 90 === 0 ? 'wind-gauge__label wind-gauge__label--primary' : 'wind-gauge__label',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      },
      label,
    );
    root.append(t);
  }

  // Gust needle (behind main needle)
  const gustNeedle = svg('g', { class: 'wind-gauge__needle wind-gauge__needle--gust', transform: `rotate(0 ${cx} ${cy})` });
  gustNeedle.append(
    svg('path', {
      d: `M ${cx} ${cy - (r - 22)} L ${cx - 5} ${cy} L ${cx + 5} ${cy} Z`,
      class: 'wind-gauge__needle-shape wind-gauge__needle-shape--gust',
    }),
  );
  root.append(gustNeedle);

  // Main needle
  const needle = svg('g', { class: 'wind-gauge__needle', transform: `rotate(0 ${cx} ${cy})` });
  needle.append(
    svg('path', {
      d: `M ${cx} ${cy - (r - 10)} L ${cx - 7} ${cy + 10} L ${cx + 7} ${cy + 10} Z`,
      class: 'wind-gauge__needle-shape',
    }),
  );
  root.append(needle);

  // Hub
  root.append(svg('circle', { cx, cy, r: 14, class: 'wind-gauge__hub' }));
  root.append(svg('circle', { cx, cy, r: 4, class: 'wind-gauge__hub-dot' }));

  // Gust readout — sits above the hub so it doesn't crowd the main speed.
  const gustText = svg(
    'text',
    {
      x: cx,
      y: cy - 50,
      class: 'wind-gauge__readout-gust',
      'text-anchor': 'middle',
    },
    'HVIÐA —',
  );
  // Main speed readout — below the hub.
  const speedText = svg(
    'text',
    {
      x: cx,
      y: cy + 52,
      class: 'wind-gauge__readout',
      'text-anchor': 'middle',
    },
    '—',
  );
  const speedUnit = svg(
    'text',
    {
      x: cx,
      y: cy + 70,
      class: 'wind-gauge__readout-unit',
      'text-anchor': 'middle',
    },
    'm/s',
  );
  root.append(gustText, speedText, speedUnit);

  return { root, needle, gustNeedle, speedText, gustText };
}

function buildReadout(label: string, id: string, unit: string): HTMLElement {
  return el(
    'div',
    { class: 'readout' },
    el('span', { class: 'readout__label' }, label),
    el(
      'div',
      { class: 'readout__screen' },
      el('span', { class: 'readout__value', id }, '—'),
      el('span', { class: 'readout__unit' }, unit),
    ),
  );
}

export function obsPanel(): Panel {
  let gauge: ReturnType<typeof buildGauge> | null = null;
  let root: HTMLElement;
  let stationLabel: HTMLElement;
  let timestampLabel: HTMLElement;
  let statusLamp: HTMLElement;
  let textaspaBody: HTMLElement;
  let textaspaTimestamp: HTMLElement;
  let obsUrl = '/api/obs';
  let textaspaUrl = '/api/textaspa';

  return {
    intervalMs: 15 * 60 * 1000,
    mount(el_root, ctx) {
      obsUrl = ctx.apiUrl('obs');
      textaspaUrl = ctx.apiUrl('textaspa');
      root = el_root;
      root.innerHTML = '';

      const header = el(
        'header',
        { class: 'panel__header' },
        el('h2', { class: 'panel__title' }, 'VEÐUR NÚNA'),
        el('div', { class: 'panel__status' }),
      );
      statusLamp = el('span', { class: 'status-lamp' });
      header.querySelector('.panel__status')!.append(statusLamp, document.createTextNode(' TENGT'));

      const body = el('div', { class: 'panel__body panel__body--obs' });

      gauge = buildGauge();
      const gaugeWrap = el('div', { class: 'panel__gauge' });
      gaugeWrap.append(gauge.root);
      const windCol = el(
        'div',
        { class: 'obs__wind' },
        el('span', { class: 'readout__label' }, 'VINDUR'),
        gaugeWrap,
      );

      const tempMain = el(
        'div',
        { class: 'readout readout--hero' },
        el('span', { class: 'readout__label' }, 'HITI'),
        el(
          'div',
          { class: 'readout__screen readout__screen--hero' },
          el('span', { class: 'readout__value', id: 'obs-temp' }, '—'),
          el('span', { class: 'readout__unit' }, '°C'),
        ),
      );
      const subRow = el(
        'div',
        { class: 'readouts readouts--sub' },
        buildReadout('DAGGARMARK', 'obs-dew', '°C'),
        buildReadout('RAKI', 'obs-rh', '%'),
        buildReadout('LOFTÞRÝSTINGUR', 'obs-pressure', 'hPa'),
      );
      const right = el('div', { class: 'obs__right' }, tempMain, subRow);

      body.append(windCol, right);

      // Textaspa section
      const textaspaSection = el('div', { class: 'textaspa' });
      const textaspaHeader = el(
        'div',
        { class: 'textaspa__header' },
        el('span', { class: 'textaspa__title' }, 'HUGLEIÐINGAR VEÐURFRÆÐINGS'),
      );
      textaspaTimestamp = el('span', { class: 'textaspa__timestamp' }, '');
      textaspaHeader.append(textaspaTimestamp);
      textaspaBody = el('div', { class: 'textaspa__body' });
      textaspaSection.append(textaspaHeader, textaspaBody);

      stationLabel = el('span', { class: 'panel__footer-label' }, ctx.station.name.toUpperCase());
      timestampLabel = el('span', { class: 'panel__footer-value', id: 'obs-ts' }, '—');
      const footer = el(
        'footer',
        { class: 'panel__footer' },
        stationLabel,
        el('span', { class: 'panel__footer-sep' }, '·'),
        el('span', { class: 'panel__footer-label' }, 'MÆLT'),
        timestampLabel,
      );

      root.append(header, body, textaspaSection, footer);
    },
    async refresh() {
      if (!gauge) return;
      try {
        const data = await getJson<Obs>(obsUrl);
        statusLamp.classList.add('status-lamp--on');
        statusLamp.classList.remove('status-lamp--alert');

        const deg = data.wind.direction ? (DIRS[data.wind.direction] ?? null) : null;
        const cx = 150;
        const cy = 150;
        if (deg !== null) {
          gauge.needle.setAttribute('transform', `rotate(${deg} ${cx} ${cy})`);
        }
        if (data.wind.gust !== null && data.wind.speed !== null) {
          const gustRatio = data.wind.gust / Math.max(data.wind.speed, 1);
          const spread = Math.min(30, (gustRatio - 1) * 60);
          const gustDeg = (deg ?? 0) + (spread || 0);
          gauge.gustNeedle.setAttribute('transform', `rotate(${gustDeg} ${cx} ${cy})`);
        }
        gauge.speedText.textContent = fmt(data.wind.speed, 0);
        gauge.gustText.textContent =
          data.wind.gust !== null ? `HVIÐA ${fmt(data.wind.gust, 0)} m/s` : 'HVIÐA —';

        document.getElementById('obs-temp')!.textContent = fmt(data.temperature, 1);
        document.getElementById('obs-dew')!.textContent = fmt(data.dewPoint, 1);
        document.getElementById('obs-rh')!.textContent = fmt(data.humidity, 0);
        document.getElementById('obs-pressure')!.textContent = fmt(data.pressure, 0);

        if (data.observedAt) {
          const fmt2 = new Intl.DateTimeFormat('is-IS', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
            hour12: false,
            timeZone: 'Atlantic/Reykjavik',
          });
          timestampLabel.textContent = fmt2.format(new Date(data.observedAt));
        }
        stationLabel.textContent = data.stationName.toUpperCase();
      } catch (err) {
        console.warn('obs refresh failed', err);
        statusLamp.classList.remove('status-lamp--on');
        statusLamp.classList.add('status-lamp--alert');
      }

      try {
        const spa = await getJson<Textaspa>(textaspaUrl);
        textaspaBody.innerHTML = '';
        const paragraphs = spa.paragraphs.filter((p) => p.trim().length > 0);
        if (paragraphs.length === 0) {
          const phrase = TEXTASPA_FALLBACKS[Math.floor(Math.random() * TEXTASPA_FALLBACKS.length)];
          textaspaBody.append(el('p', { class: 'textaspa__para textaspa__para--fallback' }, phrase));
        } else {
          for (const para of paragraphs) {
            textaspaBody.append(el('p', { class: 'textaspa__para' }, para));
          }
        }
        if (spa.createdAt) {
          const fmt3 = new Intl.DateTimeFormat('is-IS', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
            hour12: false,
            timeZone: 'Atlantic/Reykjavik',
          });
          textaspaTimestamp.textContent = fmt3.format(new Date(spa.createdAt));
        }
      } catch (err) {
        console.warn('textaspa refresh failed', err);
      }
    },
  };
}
