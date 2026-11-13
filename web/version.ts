// Version selector: the footer version tag opens a small rotary switch
// that swaps between the current skin (1.0) and the previous one (0.8).
// Only the look changes; data, panels and layout stay the same.

import legacyCss from './styles/legacy-0.8.css?inline';
import switchCss from './styles/version-switch.css?inline';

export type Version = '0.8' | '1.0';

const STORE_KEY = 'vedurstod:version';
const VERSIONS: Version[] = ['0.8', '1.0'];
const LATEST: Version = '1.0';
const NS = 'http://www.w3.org/2000/svg';
const OSWALD_HREF = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap';

// Things 0.8 did not have, so they keep working on the old skin.
const LEGACY_COMPAT = `
.console__grid > [data-panel='map'] { display: none; }
.sundial { display: none; }
.status-lamp--warn {
  background: var(--lamp-red);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 0 10px var(--lamp-red), 0 0 18px var(--lamp-glow-red);
}
`;

function stored(): Version {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === '0.8' || v === '1.0') return v;
  } catch {
    // Storage blocked: use the latest version.
  }
  return LATEST;
}

function remember(v: Version) {
  try {
    if (v === LATEST) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, v);
  } catch {
    // Works for this page load only.
  }
}

// The 1.0 stylesheet is the page's own <link>. Fonts come from Google.
function skinLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter(
    (l) => !l.href.includes('fonts.googleapis.com'),
  );
}

let current: Version = LATEST;

function apply(v: Version) {
  current = v;
  const legacy = v === '0.8';
  document.documentElement.dataset.version = v;

  for (const link of skinLinks()) link.disabled = legacy;

  let style = document.getElementById('skin-legacy') as HTMLStyleElement | null;
  if (legacy && !style) {
    style = document.createElement('style');
    style.id = 'skin-legacy';
    style.textContent = legacyCss + LEGACY_COMPAT;
    document.head.append(style);
  }
  if (style) style.disabled = !legacy;

  if (legacy && !document.getElementById('font-oswald')) {
    const font = document.createElement('link');
    font.id = 'font-oswald';
    font.rel = 'stylesheet';
    font.href = OSWALD_HREF;
    document.head.append(font);
  }

  // 0.8 had a subtitle next to the nameplate.
  const turboLine = document.querySelector('.console__brand-turbo-line');
  let byline = document.querySelector('.console__brand-byline');
  if (legacy && turboLine && !byline) {
    byline = document.createElement('span');
    byline.className = 'console__brand-byline';
    byline.textContent = 'Grand lausnir, engin vandamál.';
    turboLine.append(byline);
  } else if (!legacy && byline) {
    byline.remove();
  }

  const slug = document.getElementById('build-slug');
  if (slug) slug.textContent = `v${v}`;

  // The page may hold the old skin hidden until this point (see index.html).
  document.documentElement.removeAttribute('data-skin-pending');
}

// Runs at import time so the stored skin is in place before panels draw.
apply(stored());

function switchSvg(onPick: (v: Version) => void) {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 120 84');
  root.setAttribute('class', 'vswitch__svg');
  // Two detents, 45° left and right of top.
  const angle = (v: Version) => (v === '0.8' ? -45 : 45);
  const make = (tag: string, attrs: Record<string, string | number>) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, String(val));
    return n;
  };
  const cx = 60;
  const cy = 54;
  const labels: Record<string, SVGElement> = {};
  for (const v of VERSIONS) {
    const a = ((angle(v) - 90) * Math.PI) / 180;
    root.append(
      make('line', {
        x1: cx + Math.cos(a) * 24,
        y1: cy + Math.sin(a) * 24,
        x2: cx + Math.cos(a) * 30,
        y2: cy + Math.sin(a) * 30,
        class: 'vswitch__tick',
      }),
    );
    const t = make('text', {
      x: cx + Math.cos(a) * 42,
      y: cy + Math.sin(a) * 42 + 4,
      class: 'vswitch__pos',
      'text-anchor': 'middle',
    });
    t.textContent = v;
    t.addEventListener('click', () => onPick(v));
    labels[v] = t;
    root.append(t);
  }
  const body = make('circle', { cx, cy, r: 19, class: 'vswitch__body' });
  const grip = make('g', { class: 'vswitch__grip' });
  grip.append(
    make('rect', { x: cx - 4, y: cy - 19, width: 8, height: 38, rx: 3, class: 'vswitch__bar' }),
    make('line', { x1: cx, y1: cy - 16, x2: cx, y2: cy - 6, class: 'vswitch__pointer' }),
  );
  root.append(body, grip);
  const render = (v: Version) => {
    grip.setAttribute('transform', `rotate(${angle(v)} ${cx} ${cy})`);
    for (const k of VERSIONS) labels[k].classList.toggle('vswitch__pos--on', k === v);
  };
  return { root, render };
}

export function mountVersionSwitch() {
  const slug = document.getElementById('build-slug');
  if (!slug) return;

  const style = document.createElement('style');
  style.textContent = switchCss;
  document.head.append(style);

  const pop = document.createElement('div');
  pop.className = 'vswitch';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Velja útgáfu');

  const title = document.createElement('div');
  title.className = 'vswitch__title';
  title.textContent = 'ÚTGÁFA';

  const pick = (v: Version) => {
    if (v === current) return;
    apply(v);
    remember(v);
    sw.render(v);
  };
  const sw = switchSvg(pick);
  const knob = document.createElement('button');
  knob.type = 'button';
  knob.className = 'vswitch__knob';
  knob.setAttribute('aria-label', 'Skipta um útgáfu');
  knob.append(sw.root);
  knob.addEventListener('click', (ev) => {
    // Clicks on a position label pick that one; the knob itself flips.
    if ((ev.target as Element).classList.contains('vswitch__pos')) return;
    pick(current === '0.8' ? '1.0' : '0.8');
  });
  sw.render(current);

  pop.append(title, knob);
  document.body.append(pop);

  const place = () => {
    const r = slug.getBoundingClientRect();
    pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
    pop.style.bottom = `${window.innerHeight - r.top + 10}px`;
  };
  const close = () => {
    pop.hidden = true;
    slug.setAttribute('aria-expanded', 'false');
  };
  slug.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (pop.hidden) {
      place();
      pop.hidden = false;
      slug.setAttribute('aria-expanded', 'true');
    } else {
      close();
    }
  });
  document.addEventListener('click', (ev) => {
    if (!pop.hidden && !pop.contains(ev.target as Node)) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !pop.hidden) close();
  });
  window.addEventListener('scroll', () => !pop.hidden && place(), { passive: true });
  window.addEventListener('resize', () => !pop.hidden && place());
}
