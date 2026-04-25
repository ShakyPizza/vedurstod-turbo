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
import { DEFAULT_STATION, clearStation, loadStation, saveStation } from './station-config.ts';
import STATIONS from './stations.json';

const PANELS: Record<string, () => Panel> = {
  obs: obsPanel,
  forecast: forecastPanel,
  warnings: warningsPanel,
  moon: moonPanel,
  tides: tidesPanel,
  quakes: quakesPanel,
  traffic: () => placeholderPanel('UMFERÐ', 'rás ótengd'),
};

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

function mountPanels(ctx: PanelContext) {
  const nodes = document.querySelectorAll<HTMLElement>('[data-panel]');
  for (const node of nodes) {
    const key = node.dataset.panel;
    if (!key || !(key in PANELS)) continue;
    const panel = PANELS[key]();
    panel.mount(node, ctx);
    panel.refresh();
    if (panel.intervalMs > 0) {
      setInterval(() => panel.refresh(), panel.intervalMs);
    }
  }
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

function startSunTimes(station: Station) {
  const el = document.getElementById('sun-times');
  if (!el) return;
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
    el.textContent = `${rise} / ${set}`;
  };
  tick();
  setInterval(tick, 60 * 1000);
}

function paintStationLabel(station: Station) {
  const nameEl = document.getElementById('station-name');
  if (nameEl) nameEl.textContent = station.name.toUpperCase();
  const footerStationIdEl = document.getElementById('footer-station-id');
  if (footerStationIdEl) footerStationIdEl.textContent = ` · STÖÐ ${station.id}`;
}

function wireStationDialog(current: Station) {
  const dialog = document.getElementById('station-dialog') as HTMLDialogElement | null;
  const form = document.getElementById('station-form') as HTMLFormElement | null;
  const btn = document.getElementById('station-btn');
  const cancel = document.getElementById('station-cancel');
  const reset = document.getElementById('station-reset');
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

  if (stationSelect) {
    for (const s of STATIONS) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      stationSelect.appendChild(opt);
    }
    stationSelect.addEventListener('change', () => {
      const found = STATIONS.find((s) => String(s.id) === stationSelect.value);
      if (found) fill(found);
    });
  }

  btn.addEventListener('click', () => {
    fill(current);
    syncSelect(current);
    dialog.showModal();
  });

  cancel?.addEventListener('click', () => dialog.close('cancel'));
  reset?.addEventListener('click', () => {
    fill(DEFAULT_STATION);
    syncSelect(DEFAULT_STATION);
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const next: Station = {
      id: Number(fd.get('id')),
      name: String(fd.get('name') ?? '').trim(),
      lat: Number(fd.get('lat')),
      lon: Number(fd.get('lon')),
    };
    if (
      !Number.isFinite(next.id) ||
      next.id <= 0 ||
      !next.name ||
      !Number.isFinite(next.lat) ||
      !Number.isFinite(next.lon)
    ) {
      return;
    }
    if (
      next.id === DEFAULT_STATION.id &&
      next.name === DEFAULT_STATION.name &&
      next.lat === DEFAULT_STATION.lat &&
      next.lon === DEFAULT_STATION.lon
    ) {
      clearStation();
    } else {
      saveStation(next);
    }
    dialog.close('save');
    window.location.reload();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const station = loadStation();
  const ctx = buildContext(station);
  paintStationLabel(station);
  mountPanels(ctx);
  startClock();
  startSunTimes(station);
  wireStationDialog(station);
});
