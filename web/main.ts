import './styles/main.css';

import type { Panel, PanelContext } from './panels/types.ts';
import { obsPanel } from './panels/obs.ts';
import { forecastPanel } from './panels/forecast.ts';
import { warningsPanel } from './panels/warnings.ts';
import { moonPanel } from './panels/moon.ts';
import { placeholderPanel } from './panels/placeholder.ts';

const PANELS: Record<string, () => Panel> = {
  obs: obsPanel,
  forecast: forecastPanel,
  warnings: warningsPanel,
  moon: moonPanel,
  tides: () => placeholderPanel('SJÁVARFÖLL', 'rás ótengd'),
  quakes: () => placeholderPanel('SKJÁLFTAR', 'rás ótengd'),
  traffic: () => placeholderPanel('UMFERÐ', 'rás ótengd'),
};

const ctx: PanelContext = {
  apiBase: '/api',
  station: {
    id: 1471,
    name: 'Seltjarnarnes Suðurnes',
    lat: 64.1542,
    lon: -22.0270,
  },
};

function mountPanels() {
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

document.addEventListener('DOMContentLoaded', () => {
  mountPanels();
  startClock();
});
