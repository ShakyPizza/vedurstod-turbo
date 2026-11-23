// Name autocomplete for the station dialog. Loads every active IMO weather
// station from /api/stations once, ranks them against what the user types
// and shows the best matches in a listbox under the name field.

import type { Station } from './panels/types.ts';
import CURATED from './stations.json';

export interface SearchStation extends Station {
  region?: string;
}

interface Indexed {
  station: SearchStation;
  folded: string;
  words: string[];
  curated: boolean;
}

const MAX_RESULTS = 8;
const CURATED_IDS = new Set((CURATED as Station[]).map((s) => s.id));

// Lower-case and strip accents so "reykjavik" finds "Reykjavík" and
// "thingvellir" finds "Þingvellir".
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/þ/g, 'th')
    .replace(/ð/g, 'd')
    .replace(/æ/g, 'ae')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function index(list: SearchStation[]): Indexed[] {
  return list.map((station) => {
    const folded = fold(station.name);
    return {
      station,
      folded,
      words: folded.split(/[\s\-–/(),.]+/).filter(Boolean),
      curated: CURATED_IDS.has(station.id),
    };
  });
}

let loading: Promise<Indexed[]> | null = null;

/** Load the full station list once. Falls back to the curated list. */
export function loadStationIndex(): Promise<Indexed[]> {
  if (!loading) {
    loading = (async () => {
      const curated = CURATED as SearchStation[];
      try {
        const res = await fetch('/api/stations');
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { stations: SearchStation[] };
        const all = Array.isArray(data?.stations) ? data.stations : [];
        const ids = new Set(all.map((s) => s.id));
        return index([...all, ...curated.filter((s) => !ids.has(s.id))]);
      } catch {
        loading = null; // try again next time the dialog opens
        return index(curated);
      }
    })();
  }
  return loading;
}

/** Best matches for `query`, most likely first. */
export function rankStations(query: string, list: Indexed[], limit = MAX_RESULTS): SearchStation[] {
  const q = fold(query.trim());
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { s: Indexed; score: number }[] = [];
  for (const item of list) {
    if (/^\d+$/.test(q) && String(item.station.id).startsWith(q)) {
      scored.push({ s: item, score: String(item.station.id) === q ? 0 : 3 });
      continue;
    }
    if (!tokens.every((t) => item.folded.includes(t))) continue;
    let score: number;
    if (item.folded === q) score = 0;
    else if (item.folded.startsWith(q)) score = 1;
    else if (tokens.every((t) => item.words.some((w) => w.startsWith(t)))) score = 2;
    else score = 4;
    scored.push({ s: item, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(b.s.curated) - Number(a.s.curated) ||
      a.s.station.name.length - b.s.station.name.length ||
      a.s.station.name.localeCompare(b.s.station.name, 'is'),
  );
  return scored.slice(0, limit).map((x) => x.s.station);
}

/**
 * Turn `input` into a combobox. `onPick` runs when the user chooses a
 * station with the mouse or with Enter.
 */
export function attachStationSuggest(
  input: HTMLInputElement,
  listEl: HTMLUListElement,
  onPick: (s: SearchStation) => void,
) {
  let results: SearchStation[] = [];
  let active = -1;
  let seq = 0;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listEl.id);
  input.autocomplete = 'off';
  listEl.setAttribute('role', 'listbox');
  listEl.hidden = true;

  const close = () => {
    listEl.hidden = true;
    listEl.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    results = [];
    active = -1;
  };

  const setActive = (i: number) => {
    active = i;
    const items = listEl.children;
    for (let n = 0; n < items.length; n++) {
      items[n].setAttribute('aria-selected', String(n === i));
    }
    const el = items[i] as HTMLElement | undefined;
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const pick = (i: number) => {
    const s = results[i];
    if (!s) return;
    close();
    onPick(s);
  };

  const render = () => {
    listEl.replaceChildren();
    if (!results.length) {
      close();
      return;
    }
    results.forEach((s, i) => {
      const li = document.createElement('li');
      li.id = `${listEl.id}-${i}`;
      li.className = 'station-suggest__item';
      li.setAttribute('role', 'option');
      const name = document.createElement('span');
      name.className = 'station-suggest__name';
      name.textContent = s.name;
      const meta = document.createElement('span');
      meta.className = 'station-suggest__meta';
      meta.textContent = s.region ? `${s.region} · ${s.id}` : String(s.id);
      li.append(name, meta);
      // mousedown, not click: keep focus in the input so blur does not
      // close the list before the pick lands.
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        pick(i);
      });
      li.addEventListener('mousemove', () => {
        if (active !== i) setActive(i);
      });
      listEl.appendChild(li);
    });
    listEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(0);
  };

  input.addEventListener('input', async () => {
    const mine = ++seq;
    const list = await loadStationIndex();
    if (mine !== seq || document.activeElement !== input) return;
    results = rankStations(input.value, list);
    render();
  });

  input.addEventListener('keydown', (ev) => {
    if (listEl.hidden) {
      if (ev.key === 'ArrowDown' && input.value.trim()) {
        ev.preventDefault();
        input.dispatchEvent(new Event('input'));
      }
      return;
    }
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        setActive((active + 1) % results.length);
        break;
      case 'ArrowUp':
        ev.preventDefault();
        setActive((active - 1 + results.length) % results.length);
        break;
      case 'Enter':
        if (active >= 0) {
          ev.preventDefault();
          pick(active);
        }
        break;
      case 'Escape':
        // Close only the list, not the whole dialog.
        ev.preventDefault();
        ev.stopPropagation();
        close();
        break;
      case 'Tab':
        close();
        break;
    }
  });

  input.addEventListener('blur', () => {
    seq++;
    close();
  });

  return { close };
}
