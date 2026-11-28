// Landsspá data: the station list, regions, the forecast store and small
// formatting helpers. Times are ISO strings in UTC, which is Iceland's
// local time all year, so date parts can be read straight off the string.

import CATALOGUE from '../../server/data/landsspa-stations.json';
import { project } from '../panels/iceland-shape.ts';
import { METRO_H, METRO_W, projectMetro } from '../panels/metro-shape.ts';
import { PATTERNS, classifySky, type Sky } from '../panels/forecast.ts';

export interface StationDef {
  id: number;
  name: string;
  short: string;
  lat: number;
  lon: number;
  ele: number | null;
  /** Rank on the whole-country view (1 = place its label first). */
  overview?: number;
  metro?: boolean;
  highland?: boolean;
  staffed?: boolean;
}

export const STATIONS = CATALOGUE.stations as StationDef[];
export const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

/** A name on the map that is not a station. */
export interface MapLabel {
  text: string;
  lat: number;
  lon: number;
  kind: 'glacier' | 'lake' | 'peak' | 'place' | 'road';
}

export interface Region {
  key: string;
  name: string;
  metro?: boolean;
  /** [lat min, lat max, lon min, lon max] */
  bbox?: [number, number, number, number];
  /** Draw glaciers, lakes and the highland crossings from data/<layers>.json. */
  layers?: 'highland' | 'country';
  labels?: MapLabel[];
}

// Landmarks for the Hálendið view. Stations keep priority: a name that
// would cover a station readout is left out.
const HIGHLAND_LABELS: MapLabel[] = [
  { text: 'Vatnajökull', lat: 64.42, lon: -16.75, kind: 'glacier' },
  { text: 'Hofsjökull', lat: 64.81, lon: -18.83, kind: 'glacier' },
  { text: 'Langjökull', lat: 64.66, lon: -20.15, kind: 'glacier' },
  { text: 'Þórisvatn', lat: 64.24, lon: -18.93, kind: 'lake' },
  { text: 'Hálslón', lat: 64.85, lon: -15.8, kind: 'lake' },
  { text: 'Blöndulón', lat: 65.12, lon: -19.62, kind: 'lake' },
  { text: 'Hekla', lat: 63.992, lon: -19.666, kind: 'peak' },
  { text: 'Askja', lat: 65.043, lon: -16.755, kind: 'peak' },
  { text: 'Herðubreið', lat: 65.177, lon: -16.349, kind: 'peak' },
  { text: 'Kerlingarfjöll', lat: 64.64, lon: -19.3, kind: 'peak' },
  { text: 'Landmannalaugar', lat: 63.99, lon: -19.06, kind: 'place' },
  { text: 'Kjölur', lat: 64.6, lon: -19.72, kind: 'road' },
  { text: 'Sprengisandur', lat: 64.98, lon: -17.85, kind: 'road' },
];

export const REGIONS: Region[] = [
  { key: 'landid', name: 'Allt landið', layers: 'country' },
  { key: 'hofudborgarsvaedid', name: 'Höfuðborgarsvæðið', metro: true },
  { key: 'sudurnes', name: 'Suðurnes', bbox: [63.78, 64.13, -22.85, -21.8] },
  { key: 'sudvesturland', name: 'Suðvesturland', bbox: [63.3, 65.2, -24.1, -19.3] },
  { key: 'nordvesturland', name: 'Norðvesturland', bbox: [64.9, 66.55, -24.6, -18.6] },
  { key: 'nordausturland', name: 'Norðausturland', bbox: [64.95, 66.6, -19.4, -13.4] },
  { key: 'sudausturland', name: 'Suðausturland', bbox: [63.3, 65.35, -19.6, -13.4] },
  { key: 'halendid', name: 'Hálendið', bbox: [64.0, 65.45, -20.6, -15.4], layers: 'highland', labels: HIGHLAND_LABELS },
];

export function inCapitalArea(s: StationDef): boolean {
  const [x, y] = projectMetro(s.lat, s.lon);
  return x >= 0 && x <= METRO_W && y >= 0 && y <= METRO_H;
}

/** Stations for a region, in label-placement priority order. */
export function regionStations(r: Region): StationDef[] {
  if (r.metro) return STATIONS.filter((s) => s.metro);
  if (!r.bbox) return STATIONS.filter((s) => s.overview).sort((a, b) => a.overview! - b.overview!);
  const [a0, a1, o0, o1] = r.bbox;
  // Capital-area stations have their own view; only Reykjavík (an overview
  // station) shows elsewhere.
  return STATIONS.filter(
    (s) => s.lat >= a0 && s.lat <= a1 && s.lon >= o0 && s.lon <= o1 && (s.overview || !inCapitalArea(s)),
  );
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
  metro: boolean;
}

export function regionViewBox(r: Region): ViewBox {
  if (r.metro) return { x: 0, y: 0, w: METRO_W, h: METRO_H, metro: true };
  if (!r.bbox) return { x: -10, y: -8, w: 1020, h: 722, metro: false };
  const [a0, a1, o0, o1] = r.bbox;
  const [x0, y0] = project(a1, o0);
  const [x1, y1] = project(a0, o1);
  const px = (x1 - x0) * 0.04;
  const py = (y1 - y0) * 0.04;
  return { x: x0 - px, y: y0 - py, w: x1 - x0 + 2 * px, h: y1 - y0 + 2 * py, metro: false };
}

export const stationXY = (vb: ViewBox, s: StationDef): [number, number] =>
  vb.metro ? projectMetro(s.lat, s.lon) : project(s.lat, s.lon);

// ---------- forecast store ----------

export interface Series {
  T: (number | null)[];
  F: (number | null)[];
  D: (string | null)[];
  /** Index into `weather`, -1 for none. */
  W: number[];
  /** Precipitation in mm since the previous step. */
  R: (number | null)[];
}

interface LandsspaResponse {
  issuedAt: string | null;
  fetchedAt: string;
  times: string[];
  weather: string[];
  stations: Record<string, Series>;
}

export class ForecastStore {
  times: string[] = [];
  weather: string[] = [];
  issuedAt: string | null = null;
  readonly series = new Map<number, Series>();

  has(ids: number[]): boolean {
    return ids.every((id) => this.series.has(id));
  }

  /** Fetch these stations. A new forecast run replaces everything held. */
  async load(ids: number[]): Promise<void> {
    const res = await fetch(`/api/landsspa?ids=${ids.join(',')}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`/api/landsspa ${res.status}`);
    const data = (await res.json()) as LandsspaResponse;
    const sameRun =
      data.issuedAt === this.issuedAt &&
      data.times.length === this.times.length &&
      data.times[0] === this.times[0];
    if (!sameRun) {
      this.series.clear();
      this.times = data.times;
      this.issuedAt = data.issuedAt;
    }
    this.weather = data.weather;
    for (const [id, s] of Object.entries(data.stations)) this.series.set(Number(id), s);
  }

  weatherAt(s: Series, i: number): string | null {
    return s.W[i] >= 0 ? (this.weather[s.W[i]] ?? null) : null;
  }

  /** Hours covered by step i (the time since the previous step). */
  stepHours(i: number): number {
    if (i <= 0) return 1;
    const h = (Date.parse(this.times[i]) - Date.parse(this.times[i - 1])) / 3_600_000;
    return h > 0 ? h : 1;
  }

  sky(s: Series, i: number): Sky {
    const r = s.R[i];
    return classifySky(this.weatherAt(s, i), r == null ? null : r / this.stepHours(i));
  }
}

// ---------- days ----------

export interface Day {
  key: string; // YYYY-MM-DD
  date: Date;
  idx: number[];
}

export function groupDays(times: string[]): Day[] {
  const out: Day[] = [];
  times.forEach((t, i) => {
    const key = t.slice(0, 10);
    let d = out[out.length - 1];
    if (!d || d.key !== key) {
      d = { key, date: new Date(`${key}T00:00:00Z`), idx: [] };
      out.push(d);
    }
    d.idx.push(i);
  });
  return out;
}

/** The step closest to midday on that day. */
export function noonIndex(times: string[], d: Day): number {
  const h = (i: number) => Number(times[i].slice(11, 13));
  return d.idx.reduce((best, i) => (Math.abs(h(i) - 12) < Math.abs(h(best) - 12) ? i : best), d.idx[0]);
}

// ---------- formatting ----------

export const DAY_SHORT = ['SUN', 'MÁN', 'ÞRI', 'MIÐ', 'FIM', 'FÖS', 'LAU'];
export const DAY_LONG = ['SUNNUDAGUR', 'MÁNUDAGUR', 'ÞRIÐJUDAGUR', 'MIÐVIKUDAGUR', 'FIMMTUDAGUR', 'FÖSTUDAGUR', 'LAUGARDAGUR'];
export const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAÍ', 'JÚN', 'JÚL', 'ÁGÚ', 'SEP', 'OKT', 'NÓV', 'DES'];

const at = (iso: string) => new Date(iso);
export const hhmm = (iso: string) => iso.slice(11, 16);
export const hour = (iso: string) => iso.slice(11, 13);
export const dayShort = (iso: string) => {
  const d = at(iso);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}. ${MONTH[d.getUTCMonth()]}`;
};
export const dayLong = (iso: string) => {
  const d = at(iso);
  return `${DAY_LONG[d.getUTCDay()]} ${d.getUTCDate()}. ${MONTH[d.getUTCMonth()]}`;
};

export function fmtTemp(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v) || 0}°`;
}
export const fmtInt = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v)));
export const fmtDec = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1).replace('.', ','));
export const isFrost = (v: number | null | undefined) => v != null && Math.round(v) < 0;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- symbols ----------

const DIRS: Record<string, number> = {
  N: 0, NNA: 22.5, NA: 45, ANA: 67.5, A: 90, ASA: 112.5, SA: 135, SSA: 157.5,
  S: 180, SSV: 202.5, SV: 225, VSV: 247.5, V: 270, VNV: 292.5, NV: 315, NNV: 337.5,
};

/** Arrow pointing downwind (where the air is going). "○" when calm. */
export function windArrow(dir: string | null | undefined): string {
  if (!dir || !(dir in DIRS)) return '<span class="lp-calm" aria-hidden="true">○</span>';
  return `<svg class="lp-arw" viewBox="-6 -6 12 12" aria-hidden="true" style="transform:rotate(${DIRS[dir] + 180}deg)"><path d="M0 -5.6L4.2 1.4H1.4V5.6H-1.4V1.4H-4.2Z"/></svg>`;
}

const symbolCache = new Map<Sky, string>();
/** The dashboard's 11×11 dot-matrix weather symbol, as SVG markup. */
export function skySymbol(sky: Sky): string {
  const hit = symbolCache.get(sky);
  if (hit) return hit;
  const P = PATTERNS[sky] ?? PATTERNS.unknown;
  let on = '';
  let off = '';
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      const cx = x * 3 + 1.5;
      const cy = y * 3 + 1.5;
      const r = 1.15;
      const d = `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
      if (P[y][x] === 'X') on += d;
      else off += d;
    }
  }
  const out = `<svg class="lp-dm lp-dm--${sky}" viewBox="0 0 33 33" aria-hidden="true"><path class="lp-dm__off" d="${off}"/><path class="lp-dm__on" d="${on}"/></svg>`;
  symbolCache.set(sky, out);
  return out;
}
