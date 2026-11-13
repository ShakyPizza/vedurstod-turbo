// Header sundial (seen from above). The lit sector shows the directions the
// sun shines from today, sunrise to sunset. The sun sits on the rim at its
// current bearing, and the gnomon's shadow falls opposite it, longer when
// the sun is low. Sunrise and sunset times and bearings sit either side.

import SunCalc from 'suncalc';

interface Place {
  lat: number;
  lon: number;
}

const NS = 'http://www.w3.org/2000/svg';
const RAD = Math.PI / 180;
const C = 52;
const R = 40;
const DIRS = ['N', 'NA', 'A', 'SA', 'S', 'SV', 'V', 'NV'];

const TIME_FMT = new Intl.DateTimeFormat('is-IS', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Atlantic/Reykjavik',
});

function svg(tag: string, attrs: Record<string, string | number> = {}, parent?: Element) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.append(n);
  return n;
}

function span(cls: string, text = '') {
  const n = document.createElement('span');
  n.className = cls;
  n.textContent = text;
  return n;
}

// Compass bearing (0° = north, clockwise) and elevation in degrees.
function sunAt(date: Date, p: Place) {
  const pos = SunCalc.getPosition(date, p.lat, p.lon);
  return {
    az: ((pos.azimuth / RAD + 180) % 360 + 360) % 360,
    el: pos.altitude / RAD,
  };
}

const valid = (d: Date | undefined): d is Date => !!d && !Number.isNaN(d.getTime());
const rim = (az: number, r: number): [number, number] => [C + Math.sin(az * RAD) * r, C - Math.cos(az * RAD) * r];
const dirName = (az: number) => DIRS[Math.round(az / 45) % 8];
const fmtDeg = (v: number) => v.toFixed(1).replace('.', ',');

export function mountSundial(host: HTMLElement) {
  host.className = 'sundial';

  const riseSide = el('div', 'sundial__side sundial__side--rise');
  const riseTime = span('console__meta-value sundial__time', '--:--');
  const riseAz = span('sundial__az');
  riseSide.append(span('sundial__label', 'UPPRÁS'), riseTime, riseAz);

  const setSide = el('div', 'sundial__side');
  const setTime = span('console__meta-value sundial__time', '--:--');
  const setAz = span('sundial__az');
  setSide.append(span('sundial__label', 'SÓLSETUR'), setTime, setAz);

  const face = svg('svg', { viewBox: '0 0 104 104', class: 'sundial__face', role: 'img' }) as SVGSVGElement;
  svg('circle', { cx: C, cy: C, r: R, class: 'sundial__rim' }, face);
  for (let a = 0; a < 360; a += 15) {
    const [x0, y0] = rim(a, R);
    const [x1, y1] = rim(a, R - (a % 90 ? 3 : 6));
    svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'sundial__tick' }, face);
  }
  const sector = svg('path', { class: 'sundial__sector' }, face);
  const sectorArc = svg('path', { class: 'sundial__arc' }, face);
  for (const [a, l] of [[0, 'N'], [90, 'A'], [180, 'S'], [270, 'V']] as const) {
    const [x, y] = rim(a, R - 13);
    const t = svg('text', { x, y: y + 4, class: 'sundial__dir', 'text-anchor': 'middle' }, face);
    t.textContent = l;
  }
  const shadow = svg('line', { x1: C, y1: C, x2: C, y2: C, class: 'sundial__shadow' }, face);
  const shadowEdge = svg('line', { x1: C, y1: C, x2: C, y2: C, class: 'sundial__shadow-edge' }, face);
  svg('circle', { cx: C, cy: C, r: 3, class: 'sundial__gnomon' }, face);
  const sun = svg('circle', { r: 4.5, class: 'sundial__sun' }, face);

  host.replaceChildren(riseSide, face, setSide);

  let place: Place | null = null;
  let timer: number | null = null;

  function el(tag: string, cls: string) {
    const n = document.createElement(tag);
    n.className = cls;
    return n;
  }

  function paint() {
    if (!place) return;
    const now = new Date();
    const times = SunCalc.getTimes(now, place.lat, place.lon);
    const rise = valid(times.sunrise) ? times.sunrise : null;
    const set = valid(times.sunset) ? times.sunset : null;
    const cur = sunAt(now, place);
    const noonEl = valid(times.solarNoon) ? sunAt(times.solarNoon, place).el : cur.el;

    // Today's sector. Without a sunrise the sun is either up all day
    // (midnight sun: full ring) or down all day (polar night: no sector).
    if (rise && set) {
      const a0 = sunAt(rise, place).az;
      const a1 = sunAt(set, place).az;
      const span = (a1 - a0 + 360) % 360;
      const large = span > 180 ? 1 : 0;
      const [rx, ry] = rim(a0, R);
      const [sx, sy] = rim(a1, R);
      sector.setAttribute('d', `M${C} ${C}L${rx} ${ry}A${R} ${R} 0 ${large} 1 ${sx} ${sy}Z`);
      sectorArc.setAttribute('d', `M${rx} ${ry}A${R} ${R} 0 ${large} 1 ${sx} ${sy}`);
      riseTime.textContent = TIME_FMT.format(rise);
      setTime.textContent = TIME_FMT.format(set);
      riseAz.textContent = `${Math.round(a0)}° ${dirName(a0)}`;
      setAz.textContent = `${Math.round(a1)}° ${dirName(a1)}`;
    } else if (noonEl > 0) {
      const ring = `M${C - R} ${C}A${R} ${R} 0 1 1 ${C + R} ${C}A${R} ${R} 0 1 1 ${C - R} ${C}Z`;
      sector.setAttribute('d', ring);
      sectorArc.setAttribute('d', ring);
      riseTime.textContent = setTime.textContent = '--:--';
      riseAz.textContent = setAz.textContent = 'MIÐNÆTURSÓL';
    } else {
      sector.setAttribute('d', '');
      sectorArc.setAttribute('d', '');
      riseTime.textContent = setTime.textContent = '--:--';
      riseAz.textContent = setAz.textContent = 'SKAMMDEGI';
    }

    const up = cur.el > -0.833;
    const [x, y] = rim(cur.az, R);
    sun.setAttribute('cx', x.toFixed(2));
    sun.setAttribute('cy', y.toFixed(2));
    sun.classList.toggle('sundial__sun--down', !up);

    // Shadow of a short gnomon: length ∝ 1 / tan(elevation), capped at the rim.
    const len = up ? Math.min(R - 4, 7 / Math.tan(Math.max(cur.el, 0.5) * RAD)) : 0;
    const [shx, shy] = rim(cur.az + 180, len);
    for (const l of [shadow, shadowEdge]) {
      l.setAttribute('x2', shx.toFixed(2));
      l.setAttribute('y2', shy.toFixed(2));
    }

    const label =
      `Sólargangur: upprás ${riseTime.textContent}, sólsetur ${setTime.textContent}. ` +
      `Sól í ${Math.round(cur.az)}° (${dirName(cur.az)}), hæð ${fmtDeg(cur.el)}°.`;
    face.setAttribute('aria-label', label);
    host.title = label;
  }

  return {
    setStation(p: Place) {
      place = { lat: p.lat, lon: p.lon };
      paint();
      if (timer !== null) clearInterval(timer);
      timer = window.setInterval(paint, 60 * 1000);
    },
  };
}
