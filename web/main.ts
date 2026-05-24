import './styles/main.css';
import SunCalc from 'suncalc';

import type { Panel, PanelContext, Station } from './panels/types.ts';
import { obsPanel } from './panels/obs.ts';
import { forecastPanel } from './panels/forecast.ts';
import { warningsPanel } from './panels/warnings.ts';
import { moonPanel } from './panels/moon.ts';
import { quakesPanel } from './panels/quakes.ts';
import { tidesPanel } from './panels/tides.ts';
import { placeholderPanel } from './panels/placeholder.ts';
import { DEFAULT_STATION } from './station-config.ts';
import {
  MAX_TABS,
  buildPreset,
  loadTabs,
  parsePreset,
  presetFilename,
  saveTabs,
  type PanelLayout,
  type TabsState,
} from './tabs-config.ts';
import STATIONS from './stations.json';
import { ICON_EXPORT_DOWN, ICON_IMPORT_UP, ICON_PLUS, ICON_RESET_PANEL } from './icons.ts';

const PANELS: Record<string, () => Panel> = {
  obs: obsPanel,
  forecast: forecastPanel,
  warnings: warningsPanel,
  moon: moonPanel,
  tides: tidesPanel,
  quakes: quakesPanel,
  traffic: () => placeholderPanel('UMFERÐ', 'rás ótengd', { label: 'RÁS ÓTENGD', alert: true }),
};

type PanelKey = keyof typeof PANELS;

interface PanelBounds {
  colSpan: number;
  rowSpan: number;
  minCols: number;
  maxCols: number;
  minRows: number;
  maxRows: number;
}

const PANEL_BOUNDS: Record<PanelKey, PanelBounds> = {
  obs: { colSpan: 6, rowSpan: 5, minCols: 6, maxCols: 12, minRows: 5, maxRows: 7 },
  forecast: { colSpan: 6, rowSpan: 5, minCols: 4, maxCols: 12, minRows: 3, maxRows: 7 },
  warnings: { colSpan: 8, rowSpan: 3, minCols: 6, maxCols: 12, minRows: 3, maxRows: 6 },
  moon: { colSpan: 4, rowSpan: 3, minCols: 4, maxCols: 8, minRows: 3, maxRows: 5 },
  tides: { colSpan: 4, rowSpan: 2, minCols: 4, maxCols: 8, minRows: 2, maxRows: 4 },
  quakes: { colSpan: 8, rowSpan: 4, minCols: 6, maxCols: 12, minRows: 4, maxRows: 5 },
  traffic: { colSpan: 4, rowSpan: 2, minCols: 4, maxCols: 8, minRows: 2, maxRows: 4 },
};

const MOBILE_LAYOUT = window.matchMedia('(max-width: 700px)');

function isPanelKey(key: string | undefined): key is PanelKey {
  return Boolean(key && key in PANELS);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function defaultPanelLayout(key: PanelKey): PanelLayout {
  const bounds = PANEL_BOUNDS[key];
  return { colSpan: bounds.colSpan, rowSpan: bounds.rowSpan, minimized: false };
}

function clampPanelLayout(key: PanelKey, layout: PanelLayout): PanelLayout {
  const bounds = PANEL_BOUNDS[key];
  return {
    colSpan: clampNumber(layout.colSpan, bounds.minCols, bounds.maxCols),
    rowSpan: clampNumber(layout.rowSpan, bounds.minRows, bounds.maxRows),
    minimized: layout.minimized === true,
  };
}

function buildContext(station: Station): PanelContext {
  const apiBase = '/api';
  return {
    apiBase,
    station,
    apiUrl(endpoint: string) {
      const params = new URLSearchParams({
        station: String(station.id),
        forecastStation: String(station.forecastId ?? station.id),
        lat: station.lat.toFixed(6),
        lon: station.lon.toFixed(6),
      });
      return `${apiBase}/${endpoint}?${params}`;
    },
  };
}

const tabState: TabsState = loadTabs();
let activeIntervals: number[] = [];

function getPanelLayout(key: PanelKey): PanelLayout {
  return clampPanelLayout(key, tabState.panelLayout[key] ?? defaultPanelLayout(key));
}

function setPanelLayout(key: PanelKey, layout: PanelLayout) {
  tabState.panelLayout[key] = clampPanelLayout(key, layout);
}

function applyPanelLayout(node: HTMLElement, key: PanelKey) {
  const layout = getPanelLayout(key);
  const minimized = layout.minimized === true;
  node.classList.toggle('panel--minimized', minimized);

  if (MOBILE_LAYOUT.matches) {
    node.style.gridColumn = '';
  } else {
    node.style.gridColumn = `span ${layout.colSpan}`;
  }
  node.style.gridRow = minimized ? 'span 1' : `span ${layout.rowSpan}`;
}

function updatePanelControls(node: HTMLElement, key: PanelKey) {
  const layout = getPanelLayout(key);
  const minimize = node.querySelector<HTMLButtonElement>('[data-panel-minimize]');
  if (!minimize) return;
  const minimized = layout.minimized === true;
  minimize.textContent = minimized ? '+' : '-';
  minimize.title = minimized ? 'Opna panel' : 'Minnka panel';
  minimize.setAttribute('aria-label', minimized ? 'Opna panel' : 'Minnka panel');
  minimize.setAttribute('aria-pressed', String(minimized));
}

function applyPanelLayoutToMountedPanels() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-panel]');
  for (const node of nodes) {
    const key = node.dataset.panel;
    if (!isPanelKey(key)) continue;
    applyPanelLayout(node, key);
    updatePanelControls(node, key);
  }
}

interface ResizeState {
  key: PanelKey;
  node: HTMLElement;
  startX: number;
  startY: number;
  startCols: number;
  startRows: number;
  colUnit: number;
  rowUnit: number;
  moved: boolean;
}

let resizeState: ResizeState | null = null;

function onPanelResize(ev: PointerEvent) {
  if (!resizeState) return;
  const next = clampPanelLayout(resizeState.key, {
    colSpan: resizeState.startCols + (ev.clientX - resizeState.startX) / resizeState.colUnit,
    rowSpan: resizeState.startRows + (ev.clientY - resizeState.startY) / resizeState.rowUnit,
    minimized: false,
  });
  const current = getPanelLayout(resizeState.key);
  if (next.colSpan === current.colSpan && next.rowSpan === current.rowSpan) return;
  resizeState.moved = true;
  setPanelLayout(resizeState.key, next);
  applyPanelLayout(resizeState.node, resizeState.key);
}

function stopPanelResize() {
  if (!resizeState) return;
  const { node, moved } = resizeState;
  node.classList.remove('panel--resizing');
  document.body.classList.remove('panel-resize-active');
  window.removeEventListener('pointermove', onPanelResize);
  window.removeEventListener('pointerup', stopPanelResize);
  window.removeEventListener('pointercancel', stopPanelResize);
  if (moved) persist();
  resizeState = null;
}

function startPanelResize(ev: PointerEvent, key: PanelKey, node: HTMLElement) {
  if (ev.button !== 0 || MOBILE_LAYOUT.matches || getPanelLayout(key).minimized) return;
  const grid = node.parentElement;
  if (!grid) return;

  ev.preventDefault();
  const gridRect = grid.getBoundingClientRect();
  const gridStyle = getComputedStyle(grid);
  const colGap = parseFloat(gridStyle.columnGap) || 0;
  const rowGap = parseFloat(gridStyle.rowGap) || 0;
  const colWidth = (gridRect.width - colGap * 11) / 12;
  const rowHeight = parseFloat(gridStyle.gridAutoRows) || 112;
  const layout = getPanelLayout(key);

  resizeState = {
    key,
    node,
    startX: ev.clientX,
    startY: ev.clientY,
    startCols: layout.colSpan,
    startRows: layout.rowSpan,
    colUnit: colWidth + colGap,
    rowUnit: rowHeight + rowGap,
    moved: false,
  };

  node.classList.add('panel--resizing');
  document.body.classList.add('panel-resize-active');
  window.addEventListener('pointermove', onPanelResize);
  window.addEventListener('pointerup', stopPanelResize, { once: true });
  window.addEventListener('pointercancel', stopPanelResize, { once: true });
}

function attachPanelControls(node: HTMLElement, key: PanelKey) {
  const header = node.querySelector<HTMLElement>('.panel__header');
  if (header && !header.querySelector('[data-panel-minimize]')) {
    const actions = document.createElement('div');
    actions.className = 'panel__actions';

    const minimize = document.createElement('button');
    minimize.type = 'button';
    minimize.className = 'panel__control panel__control--minimize';
    minimize.dataset.panelMinimize = 'true';
    minimize.addEventListener('click', () => {
      const layout = getPanelLayout(key);
      setPanelLayout(key, { ...layout, minimized: !layout.minimized });
      persist();
      applyPanelLayout(node, key);
      updatePanelControls(node, key);
    });

    actions.append(minimize);
    header.append(actions);
  }

  if (!node.querySelector('.panel__resize-handle')) {
    const handle = document.createElement('div');
    handle.className = 'panel__resize-handle';
    handle.title = 'Breyta stærð panels';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', (ev) => startPanelResize(ev, key, node));
    node.append(handle);
  }

  applyPanelLayout(node, key);
  updatePanelControls(node, key);
}

function activeStation(): Station {
  return tabState.stations[tabState.activeIndex];
}

function teardownPanels() {
  for (const id of activeIntervals) clearInterval(id);
  activeIntervals = [];
  const nodes = document.querySelectorAll<HTMLElement>('[data-panel]');
  for (const node of nodes) node.replaceChildren();
}

function mountPanels(ctx: PanelContext) {
  const nodes = document.querySelectorAll<HTMLElement>('[data-panel]');
  for (const node of nodes) {
    const key = node.dataset.panel;
    if (!isPanelKey(key)) continue;
    const panel = PANELS[key]();
    panel.mount(node, ctx);
    attachPanelControls(node, key);
    panel.refresh();
    if (panel.intervalMs > 0) {
      activeIntervals.push(window.setInterval(() => panel.refresh(), panel.intervalMs));
    }
  }
}

let sunTimesInterval: number | null = null;

function paintForStation(station: Station) {
  const nameEl = document.getElementById('station-name');
  if (nameEl) nameEl.textContent = station.name.toUpperCase();
  const footerStationIdEl = document.getElementById('footer-station-id');
  if (footerStationIdEl) footerStationIdEl.textContent = ` · STÖÐ ${station.id}`;

  const sunEl = document.getElementById('sun-times');
  if (sunEl) {
    const fmt = new Intl.DateTimeFormat('is-IS', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Atlantic/Reykjavik',
    });
    const tick = () => {
      const t = SunCalc.getTimes(new Date(), station.lat, station.lon);
      const rise = t.sunrise && !Number.isNaN(t.sunrise.getTime()) ? fmt.format(t.sunrise) : '--:--';
      const set = t.sunset && !Number.isNaN(t.sunset.getTime()) ? fmt.format(t.sunset) : '--:--';
      sunEl.textContent = `${rise} / ${set}`;
    };
    tick();
    if (sunTimesInterval !== null) clearInterval(sunTimesInterval);
    sunTimesInterval = window.setInterval(tick, 60 * 1000);
  }
}

function applyActiveTab() {
  const station = activeStation();
  paintForStation(station);
  teardownPanels();
  mountPanels(buildContext(station));
  renderTabstrip();
}

function persist() {
  saveTabs(tabState);
}

type DialogMode = 'edit' | 'add';
let dialogMode: DialogMode = 'edit';
let dialogOpen = false;

function removeTabAt(index: number) {
  if (index < 0 || index >= tabState.stations.length) return;
  if (tabState.stations.length <= 1) return;
  const wasActive = index === tabState.activeIndex;
  tabState.stations.splice(index, 1);
  if (index < tabState.activeIndex) {
    tabState.activeIndex -= 1;
  } else if (tabState.activeIndex >= tabState.stations.length) {
    tabState.activeIndex = tabState.stations.length - 1;
  }
  persist();
  if (wasActive) {
    applyActiveTab();
  } else {
    renderTabstrip();
  }
}

function renderTabstrip() {
  const strip = document.getElementById('tabstrip');
  const tabs = document.getElementById('tabstrip-tabs');
  const addBtn = document.getElementById('tabstrip-add') as HTMLButtonElement | null;
  if (!strip || !tabs || !addBtn) return;
  tabs.replaceChildren();
  const canDelete = tabState.stations.length > 1;
  tabState.stations.forEach((s, i) => {
    const isActive = i === tabState.activeIndex;
    const protectedFromDelete = dialogOpen && dialogMode === 'edit' && isActive;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'tabstrip__tab' +
      (isActive ? ' tabstrip__tab--active' : '') +
      (protectedFromDelete ? ' tabstrip__tab--protected' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(isActive));
    btn.title = `${s.name} (STÖÐ ${s.id})`;

    const num = document.createElement('span');
    num.className = 'tabstrip__tab-index';
    num.textContent = String(i + 1);
    btn.appendChild(num);

    const label = document.createElement('span');
    label.className = 'tabstrip__tab-label';
    label.textContent = s.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      if (isActive) return;
      tabState.activeIndex = i;
      persist();
      applyActiveTab();
    });

    if (canDelete && !protectedFromDelete) {
      const close = document.createElement('span');
      close.className = 'tabstrip__tab-close';
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', `Fjarlægja flipa ${i + 1}`);
      close.setAttribute('tabindex', '0');
      close.textContent = '×';
      const fire = (ev: Event) => {
        ev.stopPropagation();
        removeTabAt(i);
      };
      close.addEventListener('click', fire);
      close.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fire(ev);
        }
      });
      btn.appendChild(close);
    }

    tabs.appendChild(btn);
  });

  strip.classList.toggle('tabstrip--delete-mode', dialogOpen && canDelete);
  addBtn.disabled = tabState.stations.length >= MAX_TABS;
  addBtn.innerHTML = ICON_PLUS;
}

function wireStationDialog() {
  const dialog = document.getElementById('station-dialog') as HTMLDialogElement | null;
  const form = document.getElementById('station-form') as HTMLFormElement | null;
  const btn = document.getElementById('station-btn');
  const cancel = document.getElementById('station-cancel');
  const reset = document.getElementById('station-reset');
  const remove = document.getElementById('station-remove') as HTMLButtonElement | null;
  const titleEl = document.getElementById('station-form-title');
  const saveBtn = document.getElementById('station-save');
  if (!dialog || !form || !btn) return;

  const stationSelect = document.getElementById('station-select') as HTMLSelectElement | null;

  const fill = (s: Station) => {
    (form.elements.namedItem('id') as HTMLInputElement).value = String(s.id);
    (form.elements.namedItem('name') as HTMLInputElement).value = s.name;
    (form.elements.namedItem('lat') as HTMLInputElement).value = String(s.lat);
    (form.elements.namedItem('lon') as HTMLInputElement).value = String(s.lon);
  };

  const syncSelect = (s: Station) => {
    if (!stationSelect) return;
    const match = STATIONS.find((st) => st.id === s.id);
    stationSelect.value = match ? String(match.id) : '';
  };

  if (stationSelect && stationSelect.options.length <= 1) {
    for (const s of STATIONS) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      stationSelect.appendChild(opt);
    }
    stationSelect.addEventListener('change', () => {
      const found = STATIONS.find((s) => String(s.id) === stationSelect.value);
      if (found) {
        fill(found);
        setLookupStatus('', null);
      }
    });
  }

  const status = document.getElementById('station-lookup-status');
  const setLookupStatus = (text: string, state: 'loading' | 'ok' | 'error' | null) => {
    if (!status) return;
    status.textContent = text;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  };
  async function lookupStation(id: number): Promise<Station | null> {
    setLookupStatus('Sæki…', 'loading');
    const res = await fetch(`/api/station-info?id=${id}`);
    if (res.status === 404) {
      setLookupStatus('Stöð fannst ekki á vedur.is', 'error');
      return null;
    }
    if (!res.ok) {
      setLookupStatus('Uppfletting mistókst', 'error');
      return null;
    }
    const data = (await res.json()) as Station;
    setLookupStatus(`Fyllt: ${data.name}`, 'ok');
    return data;
  }

  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && dialog.open) {
      ev.preventDefault();
      dialog.close('cancel');
    }
  };

  const openDialog = (mode: DialogMode) => {
    dialogMode = mode;
    setLookupStatus('', null);
    if (mode === 'edit') {
      const s = activeStation();
      fill(s);
      syncSelect(s);
      if (titleEl) titleEl.textContent = `STILLA FLIPA ${tabState.activeIndex + 1}`;
      if (saveBtn) saveBtn.textContent = 'Vista';
      if (remove) remove.hidden = tabState.stations.length <= 1;
    } else {
      fill(DEFAULT_STATION);
      syncSelect(DEFAULT_STATION);
      if (titleEl) titleEl.textContent = 'NÝR FLIPI';
      if (saveBtn) saveBtn.textContent = 'Bæta við';
      if (remove) remove.hidden = true;
    }
    dialogOpen = true;
    document.body.dataset.modal = 'true';
    document.addEventListener('keydown', escHandler);
    renderTabstrip();
    dialog.show();
  };

  dialog.addEventListener('close', () => {
    dialogOpen = false;
    delete document.body.dataset.modal;
    document.removeEventListener('keydown', escHandler);
    renderTabstrip();
  });

  btn.addEventListener('click', () => openDialog('edit'));

  const addBtn = document.getElementById('tabstrip-add');
  addBtn?.addEventListener('click', () => {
    if (tabState.stations.length >= MAX_TABS) return;
    openDialog('add');
  });

  const backdrop = document.getElementById('modal-backdrop');
  backdrop?.addEventListener('click', () => dialog.close('cancel'));

  cancel?.addEventListener('click', () => dialog.close('cancel'));
  reset?.addEventListener('click', () => {
    fill(DEFAULT_STATION);
    syncSelect(DEFAULT_STATION);
  });

  remove?.addEventListener('click', () => {
    if (tabState.stations.length <= 1) return;
    const removeIdx = tabState.activeIndex;
    tabState.stations.splice(removeIdx, 1);
    if (tabState.activeIndex >= tabState.stations.length) {
      tabState.activeIndex = tabState.stations.length - 1;
    }
    persist();
    dialog.close('remove');
    applyActiveTab();
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const typedId = Number(fd.get('id'));
    if (!Number.isFinite(typedId) || typedId <= 0) return;

    let next: Station;
    if (dialogMode === 'add') {
      if (tabState.stations.length >= MAX_TABS) return;
      const submitBtn = saveBtn as HTMLButtonElement | null;
      if (submitBtn) submitBtn.disabled = true;
      try {
        const looked = await lookupStation(typedId);
        if (!looked) return; // 404 or upstream error — keep dialog open
        next = looked;
        fill(looked);
        syncSelect(looked);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
      tabState.stations.push(next);
      tabState.activeIndex = tabState.stations.length - 1;
    } else {
      next = {
        id: typedId,
        name: String(fd.get('name') ?? '').trim(),
        lat: Number(fd.get('lat')),
        lon: Number(fd.get('lon')),
      };
      if (!next.name || !Number.isFinite(next.lat) || !Number.isFinite(next.lon)) return;
      tabState.stations[tabState.activeIndex] = next;
    }
    persist();
    dialog.close('save');
    applyActiveTab();
  });
}

function wirePresetIo() {
  const exportBtn = document.getElementById('preset-export');
  const importBtn = document.getElementById('preset-import');
  const fileInput = document.getElementById('preset-file') as HTMLInputElement | null;
  if (exportBtn) {
    exportBtn.innerHTML = ICON_EXPORT_DOWN;
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(buildPreset(tabState), null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = presetFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  if (importBtn && fileInput) {
    importBtn.innerHTML = ICON_IMPORT_UP;
    importBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const stations = parsePreset(text);
        const ok = window.confirm(
          `Þetta skiptir út núverandi ${tabState.stations.length} flipum fyrir ${stations.length} stöðvar úr skrá. Halda áfram?`,
        );
        if (!ok) return;
        tabState.stations = stations;
        tabState.activeIndex = 0;
        persist();
        applyActiveTab();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ókunn villa við innlestur.';
        window.alert(`Innlestur mistókst: ${msg}`);
      }
    });
  }
}

function wirePanelLayoutControls() {
  const resetBtn = document.getElementById('panel-layout-reset');
  if (resetBtn) {
    resetBtn.innerHTML = `${ICON_RESET_PANEL}<span>Endursetja viðmót</span>`;
    resetBtn.addEventListener('click', () => {
      tabState.panelLayout = {};
      persist();
      applyPanelLayoutToMountedPanels();
    });
  }
  MOBILE_LAYOUT.addEventListener('change', applyPanelLayoutToMountedPanels);
}

function startClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const fmt = new Intl.DateTimeFormat('is-IS', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Atlantic/Reykjavik',
  });
  const tick = () => {
    el.textContent = fmt.format(new Date());
  };
  tick();
  setInterval(tick, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  wireStationDialog();
  wirePresetIo();
  wirePanelLayoutControls();
  applyActiveTab();
  startClock();
});
