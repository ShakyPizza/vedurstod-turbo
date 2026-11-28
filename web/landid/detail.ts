// The selected station: latest observation, one card per day, a chart of
// the whole forecast, and the Fjarriti (an hour-by-hour list).

import { getJson } from '../panels/types.ts';
import {
  BY_ID,
  DAY_SHORT,
  type Day,
  type ForecastStore,
  type Series,
  esc,
  fmtDec,
  fmtInt,
  fmtTemp,
  hhmm,
  hour,
  isFrost,
  noonIndex,
  skySymbol,
  windArrow,
  dayShort,
} from './data.ts';

interface Obs {
  observedAt: string | null;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  precipitation: number | null;
  wind: { speed: number | null; gust: number | null; max: number | null; direction: string | null };
}

const OBS_TTL = 5 * 60 * 1000;
const obsCache = new Map<number, { at: number; value: Promise<Obs | null> }>();
function fetchObs(id: number): Promise<Obs | null> {
  const hit = obsCache.get(id);
  if (hit && Date.now() - hit.at < OBS_TTL) return hit.value;
  const value = getJson<Obs>(`/api/obs?station=${id}`).catch(() => null);
  obsCache.set(id, { at: Date.now(), value });
  return value;
}

/** Sum of precipitation per day. R at 00:00 belongs to the day before. */
function dailyRain(store: ForecastStore, s: Series): Map<string, number> {
  const out = new Map<string, number>();
  store.times.forEach((t, i) => {
    const r = s.R[i];
    if (r == null) return;
    const key = new Date(Date.parse(t) - 60_000).toISOString().slice(0, 10);
    out.set(key, (out.get(key) ?? 0) + r);
  });
  return out;
}

function chart(store: ForecastStore, s: Series, ti: number, days: Day[]): string {
  const W = 900;
  const H = 120;
  const pl = 30;
  const pr = 30;
  const pt = 8;
  const pb = 18;
  const t0 = Date.parse(store.times[0]);
  const span = Date.parse(store.times[store.times.length - 1]) - t0 || 1;
  const X = (i: number) => pl + ((Date.parse(store.times[i]) - t0) / span) * (W - pl - pr);
  const temps = s.T.filter((v): v is number => v != null);
  const winds = s.F.filter((v): v is number => v != null);
  const tmin = Math.floor(Math.min(...temps, 0) / 5) * 5;
  const tmax = Math.ceil(Math.max(...temps, 5) / 5) * 5;
  const fmax = Math.max(10, Math.ceil(Math.max(...winds, 0) / 5) * 5);
  const YT = (v: number) => pt + (1 - (v - tmin) / (tmax - tmin)) * (H - pt - pb);
  const YF = (v: number) => pt + (1 - v / fmax) * (H - pt - pb);
  let g = '';
  for (let v = tmin; v <= tmax; v++) g += `<line class="${v % 5 ? 'lp-chart__g' : 'lp-chart__gm'}" x1="${pl}" x2="${W - pr}" y1="${YT(v)}" y2="${YT(v)}"/>`;
  for (let v = tmin; v <= tmax; v += 5) g += `<text x="${pl - 4}" y="${YT(v) + 4}" text-anchor="end">${v}°</text>`;
  for (let v = 0; v <= fmax; v += 5) g += `<text x="${W - pr + 4}" y="${YF(v) + 4}">${v}</text>`;
  for (const d of days) {
    const x = X(d.idx[0]);
    g += `<line class="lp-chart__gm" x1="${x}" x2="${x}" y1="${pt}" y2="${H - pb}"/><text x="${x + 3}" y="${H - 4}">${DAY_SHORT[d.date.getUTCDay()]}</text>`;
  }
  // Precipitation as bars of mm per hour; 8 mm/h or more fills the height.
  let bars = '';
  store.times.forEach((_, i) => {
    const r = s.R[i];
    if (!r || i === 0) return;
    const rate = r / store.stepHours(i);
    const h = Math.min(1, rate / 8) * (H - pt - pb);
    const x0 = X(i - 1);
    const x1 = X(i);
    bars += `<rect class="lp-chart__rain" x="${x0}" y="${H - pb - h}" width="${Math.max(1, x1 - x0 - 0.5)}" height="${h}"/>`;
  });
  const line = (arr: (number | null)[], Y: (v: number) => number) =>
    arr.map((v, i) => (v == null ? '' : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${g}${bars}
    <polyline class="lp-chart__wind" points="${line(s.F, YF)}"/>
    <polyline class="lp-chart__temp" points="${line(s.T, YT)}"/>
    <line class="lp-chart__now" x1="${X(ti)}" x2="${X(ti)}" y1="${pt}" y2="${H - pb}"/></svg>`;
}

export interface DetailCallbacks {
  setTime(ti: number): void;
  openOnDashboard(id: number): void;
}

export function renderDetail(
  box: HTMLElement,
  store: ForecastStore,
  days: Day[],
  id: number,
  ti: number,
  cb: DetailCallbacks,
) {
  const def = BY_ID.get(id);
  const s = store.series.get(id);
  if (!def || !s) {
    box.innerHTML =
      '<header class="panel__header"><h2 class="panel__title">STAÐASPÁ</h2></header><span class="lp-legend">Veldu stöð á kortinu.</span>';
    delete box.dataset.key;
    return;
  }
  const curDay = days.findIndex((d) => d.idx.includes(ti));
  // Same station and forecast run: only the time moved. Update the parts
  // that show it, so the observation card does not reload.
  const key = `${id}|${store.issuedAt}|${store.times[0]}`;
  if (box.dataset.key === key) {
    box.querySelectorAll<HTMLElement>('[data-day]').forEach((b) =>
      b.classList.toggle('lp-day--cur', Number(b.dataset.day) === curDay),
    );
    const old = box.querySelector('.lp-chart');
    if (old) old.outerHTML = chart(store, s, ti, days);
    return;
  }
  const rain = dailyRain(store, s);
  const cards = days
    .slice(0, 7)
    .map((d, k) => {
      const n = noonIndex(store.times, d);
      const temps = d.idx.map((i) => s.T[i]).filter((v): v is number => v != null);
      const h = hour(store.times[n]);
      const mm = rain.get(d.key);
      return `<button type="button" class="lp-day${k === curDay ? ' lp-day--cur' : ''}" data-day="${k}">
        <span class="lp-day__name">${DAY_SHORT[d.date.getUTCDay()]}</span>
        <span class="lp-day__date">${h !== '12' ? `kl. ${h}` : `${d.date.getUTCDate()}.${d.date.getUTCMonth() + 1}.`}</span>
        <span class="lp-day__wind">${windArrow(s.D[n])} ${fmtInt(s.F[n])} m/s</span>
        <span class="lp-glass lp-day__sky">${skySymbol(store.sky(s, n))}</span>
        <span class="lp-day__temp ${isFrost(s.T[n]) ? 'lp-cold' : 'lp-warm'}">${fmtTemp(s.T[n])}</span>
        <span class="lp-day__range">${temps.length ? `${fmtTemp(Math.min(...temps))} / ${fmtTemp(Math.max(...temps))}` : ''}</span>
        <span class="lp-day__rain">${mm != null ? `${fmtDec(mm)} mm` : ''}</span>
      </button>`;
    })
    .join('');

  box.innerHTML = `
    <header class="panel__header lp-tight">
      <h2 class="panel__title">${esc(def.short.toUpperCase())} · STAÐASPÁ</h2>
      <span class="panel__status">STÖÐ ${def.id}${def.ele != null ? ` · ${def.ele} M Y.S.` : ''} · DAGSPÁ KL. 12</span>
      <button type="button" class="lp-key lp-sp lp-open-dash" title="Opna stöðina á Mínum stöðvum">＋ Mínar stöðvar</button>
    </header>
    <div class="lp-det">
      <div class="lp-glass lp-obs"><span class="lp-legend lp-obs__lead">SÍÐASTA ATHUGUN · <span class="lp-obs__time">--:--</span></span><div class="lp-obs__body"><span class="lp-legend">Sæki…</span></div></div>
      <div class="lp-det__right">
        <div class="lp-days">${cards}</div>
        <div class="lp-chart-wrap">
          <div class="lp-chart__legend lp-legend">
            <span><i class="lp-chart__key lp-chart__key--temp"></i>HITI °C</span>
            <span><i class="lp-chart__key lp-chart__key--wind"></i>VINDUR m/s</span>
            <span><i class="lp-chart__key lp-chart__key--rain"></i>ÚRKOMA</span>
            <span class="lp-sp">SÍRITI</span>
          </div>
          ${chart(store, s, ti, days)}
        </div>
      </div>
    </div>`;
  box.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((b) =>
    b.addEventListener('click', () => cb.setTime(noonIndex(store.times, days[Number(b.dataset.day)]))),
  );
  box.querySelector('.lp-open-dash')!.addEventListener('click', () => cb.openOnDashboard(id));

  void fetchObs(id).then((o) => {
    const body = box.querySelector<HTMLElement>('.lp-obs__body');
    if (!body || box.dataset.key !== key) return;
    if (!o || (o.temperature == null && o.wind.speed == null)) {
      body.innerHTML = '<span class="lp-legend">Engin nýleg athugun.</span>';
      return;
    }
    box.querySelector('.lp-obs__time')!.textContent = o.observedAt ? hhmm(o.observedAt) : '--:--';
    const row = (label: string, value: string) => `<div class="lp-obs__row">${label}<b>${value}</b></div>`;
    body.innerHTML = `
      <div class="lp-obs__big"><span class="lp-read lp-obs__temp${isFrost(o.temperature) ? ' lp-frost' : ''}">${o.temperature != null ? `${fmtDec(o.temperature)}°` : '—'}</span>
        <span class="lp-obs__wind">${windArrow(o.wind.direction)} ${fmtInt(o.wind.speed)}<small>m/s</small></span></div>
      ${row('MESTI 10 MÍN VINDUR', `${fmtInt(o.wind.max)} m/s`)}
      ${row('MESTA HVIÐA', `${fmtInt(o.wind.gust)} m/s`)}
      ${row('ÚRKOMA 1 KLST', `${fmtDec(o.precipitation)} mm`)}
      ${row('RAKASTIG', `${fmtInt(o.humidity)} %`)}
      ${row('LOFTÞRÝSTINGUR', `${fmtInt(o.pressure)} hPa`)}`;
  });
  box.dataset.key = key;
}

/** Teleprinter list: observation summary, then hour rows for `ndays` days. */
export function renderFjarriti(
  box: HTMLElement,
  store: ForecastStore,
  days: Day[],
  id: number,
  ti: number,
  ndays: number,
  pick: (ti: number) => void,
) {
  const def = BY_ID.get(id);
  const s = store.series.get(id);
  if (!def || !s) {
    box.textContent = '';
    return;
  }
  const pad = (v: string, n: number) => v.padEnd(n);
  const lpad = (v: string, n: number) => v.padStart(n);
  const short = (w: string | null) => (w ?? '').replace('Lítils háttar', 'Lítil').toUpperCase();
  const cur = days.findIndex((d) => d.idx.includes(ti));
  let out = `<div class="lp-tty__head"><b>VEÐURSTOFA ÍSLANDS · STAÐASPÁ\n${esc(def.short.toUpperCase())} (${def.id})${def.ele != null ? ` · ${def.ele} M` : ''}</b>\n`;
  out += `------------------------------</div>`;
  for (const [k, d] of days.entries()) {
    if (k < cur || k >= cur + ndays) continue;
    out += `<div class="lp-tty__day"><b>${dayShort(store.times[d.idx[0]])}</b>\nKL  ÁTT  M/S  °C   MM  VEÐUR\n`;
    for (const i of d.idx) {
      const t = s.T[i];
      const r = s.R[i];
      const row =
        `${hour(store.times[i])}  ${pad(s.D[i] ?? '—', 4)}${lpad(fmtInt(s.F[i]), 4)} ` +
        `<span class="${isFrost(t) ? 'lp-cold' : 'lp-warm'}">${lpad(fmtTemp(t), 4)}</span>` +
        `${lpad(r == null ? '' : fmtDec(r), 5)}  ${esc(short(store.weatherAt(s, i)))}`;
      out += `<span class="lp-tty__row${i === ti ? ' lp-tty__row--cur' : ''}" data-i="${i}">${row}</span>`;
    }
    out += '\n</div>';
  }
  box.innerHTML = out;
  box.querySelectorAll<HTMLElement>('[data-i]').forEach((r) => r.addEventListener('click', () => pick(Number(r.dataset.i))));
  // Keep the current row in view without scrolling the page.
  const row = box.querySelector<HTMLElement>('.lp-tty__row--cur');
  if (row && box.clientHeight && box.scrollHeight > box.clientHeight) {
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop + 40) box.scrollTop = Math.max(0, top - 40);
    else if (bottom > box.scrollTop + box.clientHeight - 20) box.scrollTop = bottom - box.clientHeight + 60;
  }
}
