// Landsspá (/landid): the nationwide station forecast map. Pick a region,
// step through the forecast, click a station for its forecast and the
// Fjarriti (an hour-by-hour list).
//
// The page is built from the dashboard's own parts (main.css): the same
// header with nameplate, sundial and clock, the same tab strip, panel shells
// and footer. Dark is the dashboard's look; light (the default here) is the
// same parts in taupe, set in landid.css.

import '../styles/main.css';
import '../styles/version-switch.css';
import '../styles/landid.css';
import { mountSundial } from '../sundial.ts';
import { MAX_TABS, loadTabs, saveTabs, type TabsState } from '../tabs-config.ts';
import {
  BY_ID,
  type Day,
  ForecastStore,
  REGIONS,
  type Region,
  dayShort,
  esc,
  groupDays,
  hhmm,
  regionStations,
} from './data.ts';
import { createMap } from './map.ts';
import { createTimeBar } from './timebar.ts';
import { renderDetail, renderFjarriti } from './detail.ts';

const THEME_KEY = 'vedurstod:landid-theme';
const START_KEY = 'vedurstod:start';
const TABS_KEY = 'vedurstod:tabs';
const REFRESH_MS = 30 * 60 * 1000;
const WIDE = window.matchMedia('(min-width: 1100px)');

const store = new ForecastStore();
let days: Day[] = [];

const state = {
  ti: 0,
  region: regionFromHash(),
  sel: homeStation(),
  names: false,
};

function regionFromHash(): Region {
  const key = decodeURIComponent(location.hash.slice(1));
  return REGIONS.find((r) => r.key === key) ?? REGIONS[0];
}

/** Saved dashboard tabs, or null for someone who has none yet. */
function savedTabs(): TabsState | null {
  try {
    return localStorage.getItem(TABS_KEY) || localStorage.getItem('vedurstod:station') ? loadTabs() : null;
  } catch {
    return null;
  }
}

/** The dashboard's active station when it is on this map, else Reykjavík. */
function homeStation(): number {
  const tabs = savedTabs();
  const id = tabs?.stations[tabs.activeIndex]?.id;
  return id && BY_ID.has(id) ? id : 1;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Works for this page load only.
  }
}

// ---------- page ----------

const root = document.getElementById('landid')!;
root.innerHTML = `
  <header class="console__header">
    <div class="console__brand">
      <span class="console__brand-line">VEÐURSTÖÐ</span>
      <div class="console__brand-turbo-line">
        <span class="console__brand-line console__brand-line--big">TURBO</span>
      </div>
    </div>
    <div class="sundial" aria-label="Sólargangur"></div>
    <div class="console__meta">
      <span class="console__meta-label">STÖÐ</span>
      <span class="console__meta-value lp-head-station">—</span>
      <span class="console__meta-label">KL.</span>
      <span class="console__meta-value lp-clock">--:--:--</span>
    </div>
  </header>
  <nav class="tabstrip" aria-label="Síður og veðurstöðvar">
    <a class="tabstrip__tab tabstrip__page-link tabstrip__tab--active" href="/landid" aria-current="page" title="Staðaspá fyrir allt landið">Landsspá</a>
    <div class="tabstrip__tabs lp-station-tabs"></div>
    <div class="tabstrip__sep" aria-hidden="true"></div>
    <div class="tabstrip__tools">
      <button type="button" class="tabstrip__tool lp-tool lp-start" title="Síðan sem opnast fyrst"></button>
      <button type="button" class="tabstrip__tool lp-tool lp-theme" role="switch" aria-label="Dökkt útlit" title="Ljóst eða dökkt útlit">
        <span class="lp-theme__track" aria-hidden="true"><span class="lp-theme__knob"></span></span><span aria-hidden="true">DÖKKT</span>
      </button>
    </div>
  </nav>
  <div class="lp-grid">
    <aside class="lp-rail">
      <section class="panel lp-regions-panel">
        <header class="panel__header"><h2 class="panel__title">SVÆÐI</h2></header>
        <div class="lp-regions" role="group" aria-label="Svæði">
          ${REGIONS.map((r) => `<button type="button" class="lp-key" data-region="${r.key}">${esc(r.name)}</button>`).join('')}
        </div>
      </section>
      <div class="lp-tty-hi"></div>
    </aside>
    <section class="panel lp-mappanel">
      <header class="panel__header lp-tight">
        <h2 class="panel__title">SPÁKORT</h2>
        <div class="panel__status lp-sp"><span class="status-lamp lp-status-lamp"></span><span class="lp-status-text"></span></div>
        <button type="button" class="lp-key lp-names" aria-pressed="false">Nöfn</button>
      </header>
      <div class="lp-map"></div>
      <footer class="panel__footer">
        <span class="map__credit">STRANDLÍNA © OPENSTREETMAP</span>
        <span class="panel__footer-label lp-sp">SPÁ GERÐ</span>
        <span class="panel__footer-value lp-issued">--:--</span>
      </footer>
    </section>
  </div>
  <section class="panel lp-time">
    <header class="panel__header"><h2 class="panel__title">SPÁTÍMI</h2></header>
    <div class="lp-time__body"></div>
  </section>
  <section class="panel lp-station" aria-live="polite"></section>
  <section class="lp-tty-low"></section>
  <footer class="console__footer">
    <span class="console__footer-slug">GÖGN&nbsp;FRÁ&nbsp;<a href="https://www.vedur.is" target="_blank" rel="noopener noreferrer" class="console__footer-link">VEÐURSTOFU&nbsp;ÍSLANDS</a></span>
    <span class="console__footer-slug console__footer-right">
      <span class="console__footer-credit">Hannað af <a href="https://x.com/kjassiturbo" target="_blank" rel="noopener noreferrer" class="console__footer-link">Kjartani Magnússyni</a> og Benedikt Orra Péturssyni</span>
      <span class="console__footer-sep" aria-hidden="true">·</span>
      <span class="console__footer-slug">v1.1</span>
    </span>
  </footer>`;

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const stationBox = $('.lp-station');
const statusLamp = $('.lp-status-lamp');
const statusText = $('.lp-status-text');
const headStation = $('.lp-head-station');
const sundial = mountSundial($('.sundial'));

// Fjarriti: below the regions on wide screens, under the station otherwise.
const tty = document.createElement('section');
tty.className = 'panel lp-tty-panel';
tty.innerHTML =
  '<header class="panel__header"><h2 class="panel__title">FJARRITI</h2></header><div class="lp-tty"></div>';
const ttyBox = tty.querySelector<HTMLElement>('.lp-tty')!;
function placeTty() {
  (WIDE.matches ? $('.lp-tty-hi') : $('.lp-tty-low')).append(tty);
}
placeTty();
WIDE.addEventListener('change', () => {
  placeTty();
  render();
});

const map = createMap($('.lp-map'), (id) => select(id));
const timebar = createTimeBar($('.lp-time__body'), (ti) => setTime(ti));

// ---------- header clock ----------

const clockFmt = new Intl.DateTimeFormat('is-IS', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});
const clock = $('.lp-clock');
const tick = () => (clock.textContent = clockFmt.format(new Date()));
tick();
window.setInterval(tick, 1000);

// ---------- tab strip: the dashboard's station tabs ----------

function renderStationTabs() {
  const host = $('.lp-station-tabs');
  host.replaceChildren();
  const tabs = savedTabs();
  tabs?.stations.forEach((s, i) => {
    const a = document.createElement('a');
    a.className = 'tabstrip__tab';
    a.href = '/';
    a.title = `${s.name} (STÖÐ ${s.id})`;
    a.innerHTML = `<span class="tabstrip__tab-index">${i + 1}</span><span class="tabstrip__tab-label">${esc(s.name)}</span>`;
    a.addEventListener('click', () => {
      tabs.activeIndex = i;
      try {
        saveTabs(tabs);
      } catch {
        // Storage blocked: the dashboard opens on its saved tab.
      }
    });
    host.append(a);
  });
}
renderStationTabs();

// ---------- theme and start page ----------

const themeBtn = $<HTMLButtonElement>('.lp-theme');
function applyTheme(t: 'light' | 'dark') {
  document.documentElement.dataset.theme = t;
  themeBtn.setAttribute('aria-checked', String(t === 'dark'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#1a1614' : '#c4b79e');
}
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  write(THEME_KEY, next);
  applyTheme(next);
});

const startBtn = $<HTMLButtonElement>('.lp-start');
function showStart() {
  const v = read(START_KEY) === 'stod' ? 'stod' : 'landid';
  startBtn.textContent = `UPPHAFSSÍÐA · ${v === 'stod' ? 'STÖÐ' : 'LAND'}`;
  startBtn.setAttribute('aria-label', `Upphafssíða: ${v === 'stod' ? 'stöð' : 'land'}. Smelltu til að breyta.`);
}
startBtn.addEventListener('click', () => {
  write(START_KEY, read(START_KEY) === 'stod' ? 'landid' : 'stod');
  showStart();
});
showStart();

// ---------- regions, names, keys ----------

const regionBtns = root.querySelectorAll<HTMLButtonElement>('[data-region]');
function showRegion() {
  regionBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.region === state.region.key)));
}
regionBtns.forEach((b) =>
  b.addEventListener('click', () => {
    const r = REGIONS.find((x) => x.key === b.dataset.region);
    if (r && r !== state.region) void setRegion(r);
  }),
);
window.addEventListener('hashchange', () => {
  const r = regionFromHash();
  if (r !== state.region) void setRegion(r, false);
});

const namesBtn = $<HTMLButtonElement>('.lp-names');
namesBtn.addEventListener('click', () => {
  state.names = !state.names;
  namesBtn.setAttribute('aria-pressed', String(state.names));
  map.setNames(state.names);
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest('input, textarea, select') || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    setTime(state.ti + (e.key === 'ArrowRight' ? 1 : -1));
  }
});

// ---------- data ----------

function setStatus(kind: 'ok' | 'load' | 'error', text = '') {
  statusLamp.className = `status-lamp lp-status-lamp${kind === 'ok' ? ' status-lamp--on' : kind === 'error' ? ' status-lamp--alert' : ''}`;
  statusText.textContent = text;
}

/** Make sure the region's stations and the selected one are loaded. */
async function ensure(force = false) {
  const ids = [...new Set([...regionStations(state.region).map((s) => s.id), state.sel])];
  if (!force && store.has(ids)) return;
  setStatus('load', 'SÆKI');
  const keepTime = store.times[state.ti];
  try {
    await store.load(ids);
    setStatus('ok');
  } catch (err) {
    console.warn('landsspá load failed', err);
    setStatus('error', 'VILLA');
    return;
  }
  days = groupDays(store.times);
  timebar.setTimes(store.times, days, store.issuedAt);
  // Stay on the same time if the new data has it; otherwise start at the
  // current hour (or the first step).
  const same = keepTime ? store.times.indexOf(keepTime) : -1;
  if (same >= 0) state.ti = same;
  else {
    const now = Date.now() - 30 * 60 * 1000;
    state.ti = Math.max(0, store.times.findIndex((t) => Date.parse(t) >= now));
  }
  $('.lp-issued').textContent = store.issuedAt ? `${dayShort(store.issuedAt)} ${hhmm(store.issuedAt)}` : '--:--';
}

async function setRegion(r: Region, updateHash = true) {
  state.region = r;
  if (updateHash) history.replaceState(null, '', r === REGIONS[0] ? location.pathname : `#${r.key}`);
  showRegion();
  map.setRegion(r);
  render();
  await ensure();
  render();
}

function select(id: number) {
  state.sel = id;
  render();
}

function setTime(ti: number) {
  if (!store.times.length) return;
  state.ti = Math.max(0, Math.min(store.times.length - 1, ti));
  render();
}

function openOnDashboard(id: number) {
  const def = BY_ID.get(id);
  if (!def) return;
  const station = { id: def.id, name: def.name, lat: def.lat, lon: def.lon };
  try {
    const tabs = savedTabs() ?? { stations: [], activeIndex: 0, panelLayout: {}, panelOrder: [] };
    const at = tabs.stations.findIndex((s) => s.id === id);
    if (at >= 0) tabs.activeIndex = at;
    else if (tabs.stations.length < MAX_TABS) {
      tabs.stations.push(station);
      tabs.activeIndex = tabs.stations.length - 1;
    } else {
      // All tabs in use: show the station in the active tab instead.
      tabs.stations[tabs.activeIndex] = station;
    }
    saveTabs(tabs);
  } catch {
    // Storage blocked: the dashboard opens with its default station.
  }
  location.href = '/';
}

// Columns that fit when the Fjarriti sits under the station panel.
function fjarritiColumns(): number {
  if (WIDE.matches) return 1;
  const w = $('.lp-tty-low').clientWidth - 76;
  return Math.max(1, Math.min(3, Math.floor((w + 32) / (290 + 32))));
}

let headFor = 0;
function render() {
  const def = BY_ID.get(state.sel);
  if (def && headFor !== def.id) {
    headFor = def.id;
    headStation.textContent = def.name.toUpperCase();
    sundial.setStation(def);
  }
  if (!store.times.length) return;
  timebar.show(state.ti);
  map.paint(store, state.ti, state.sel);
  renderDetail(stationBox, store, days, state.sel, state.ti, { setTime, openOnDashboard });
  const cols = fjarritiColumns();
  ttyBox.style.columnCount = cols > 1 ? String(cols) : '';
  ttyBox.classList.toggle('lp-tty--cols', cols > 1);
  renderFjarriti(ttyBox, store, days, state.sel, state.ti, Math.max(2, cols), setTime);
}

let lastWidth = 0;
new ResizeObserver(() => {
  const w = root.clientWidth;
  if (Math.abs(w - lastWidth) > 40) {
    lastWidth = w;
    if (!WIDE.matches) render();
  }
}).observe(root);
new ResizeObserver(() => map.relayout()).observe($('.lp-map'));

showRegion();
map.setRegion(state.region);
render();
void ensure().then(render);
window.setInterval(() => void ensure(true).then(render), REFRESH_MS);
