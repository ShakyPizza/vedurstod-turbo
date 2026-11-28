// Time controls: a readout with the valid time, step buttons, a play
// button and a tape with one tick per forecast step. Dragging or clicking
// the tape picks the nearest step.

import { DAY_SHORT, type Day, dayShort, hhmm, noonIndex } from './data.ts';

export interface TimeBar {
  /** New forecast run: rebuild the tape. */
  setTimes(times: string[], days: Day[], issuedAt: string | null): void;
  show(ti: number): void;
  stop(): void;
}

export function createTimeBar(root: HTMLElement, onChange: (ti: number) => void): TimeBar {
  let times: string[] = [];
  let days: Day[] = [];
  let issuedAt: string | null = null;
  let ti = 0;
  let timer: number | null = null;

  root.innerHTML = `
    <div class="lp-counter lp-glass" aria-live="polite">
      <div class="lp-counter__lead">GILDIR</div>
      <div class="lp-counter__day lp-read"></div>
      <div class="lp-counter__time lp-read"></div>
      <div class="lp-counter__lead lp-counter__run"></div>
    </div>
    <div class="lp-keys">
      <button type="button" class="lp-key" data-step="-day" title="Fyrri dagur" aria-label="Fyrri dagur">◀◀</button>
      <button type="button" class="lp-key" data-step="-1" title="Skref aftur (←)" aria-label="Skref aftur">◀</button>
      <button type="button" class="lp-key lp-play" aria-pressed="false">▶ Spila</button>
      <button type="button" class="lp-key" data-step="1" title="Skref fram (→)" aria-label="Skref fram">▶</button>
      <button type="button" class="lp-key" data-step="+day" title="Næsti dagur" aria-label="Næsti dagur">▶▶</button>
    </div>
    <div class="lp-tape-box"><div class="lp-tape" role="slider" tabindex="0" aria-label="Spátími"></div></div>`;

  const dayEl = root.querySelector<HTMLElement>('.lp-counter__day')!;
  const timeEl = root.querySelector<HTMLElement>('.lp-counter__time')!;
  const runEl = root.querySelector<HTMLElement>('.lp-counter__run')!;
  const tapeBox = root.querySelector<HTMLElement>('.lp-tape-box')!;
  const tape = root.querySelector<HTMLElement>('.lp-tape')!;
  const play = root.querySelector<HTMLButtonElement>('.lp-play')!;

  const t0 = () => Date.parse(times[0]);
  const span = () => Date.parse(times[times.length - 1]) - t0() + 3 * 3_600_000;
  const pct = (ms: number) => ((ms - t0()) / span()) * 100;

  function buildTape() {
    if (!times.length) return;
    const W = tapeBox.clientWidth || 700;
    let html = '<div class="lp-tape__rail"></div>';
    for (const d of days) {
      const start = d.date.getTime();
      const left = Math.max(0, pct(start));
      const right = Math.min(100, pct(start + 86_400_000));
      const px = ((right - left) / 100) * W;
      const first = times[d.idx[0]];
      const label =
        px > 104 ? dayShort(first) : px > 68 ? `${DAY_SHORT[d.date.getUTCDay()]} ${d.date.getUTCDate()}` : px > 32 ? DAY_SHORT[d.date.getUTCDay()] : '';
      html += `<div class="lp-tape__day" style="left:${left}%;width:${right - left}%"><span>${label}</span></div>`;
      for (const i of d.idx) {
        const h = Number(times[i].slice(11, 13));
        const x = pct(Date.parse(times[i]));
        const major = h % 6 === 0;
        html += `<div class="lp-tape__tick${major ? ' lp-tape__tick--major' : ''}" style="left:${x}%"></div>`;
        if ((major && h !== 0 && px > 120) || (h === 12 && px > 50 && px <= 120)) {
          html += `<span class="lp-tape__hour" style="left:${x}%">${String(h).padStart(2, '0')}</span>`;
        }
      }
    }
    html += '<div class="lp-tape__needle"></div>';
    tape.innerHTML = html;
    showNeedle();
  }

  function showNeedle() {
    const n = tape.querySelector<HTMLElement>('.lp-tape__needle');
    if (n && times[ti]) n.style.left = `${pct(Date.parse(times[ti]))}%`;
  }

  function nearest(clientX: number): number {
    const r = tape.getBoundingClientRect();
    const t = t0() + ((clientX - r.left) / r.width) * span();
    let best = 0;
    let bestD = Infinity;
    times.forEach((tt, i) => {
      const d = Math.abs(Date.parse(tt) - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  let dragging = false;
  tape.addEventListener('pointerdown', (e) => {
    dragging = true;
    tape.setPointerCapture(e.pointerId);
    onChange(nearest(e.clientX));
  });
  tape.addEventListener('pointermove', (e) => {
    if (dragging) onChange(nearest(e.clientX));
  });
  tape.addEventListener('pointerup', () => (dragging = false));
  tape.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') return; // handled page-wide
    if (e.key === 'Home') onChange(0);
    if (e.key === 'End') onChange(times.length - 1);
  });

  function dayStep(dir: number) {
    const cur = days.findIndex((d) => d.idx.includes(ti));
    const next = days[cur + dir];
    if (next) onChange(noonIndex(times, next));
  }

  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const s = b.dataset.step!;
      if (s === '-day') dayStep(-1);
      else if (s === '+day') dayStep(1);
      else onChange(Math.max(0, Math.min(times.length - 1, ti + Number(s))));
    }),
  );

  function stop() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    play.setAttribute('aria-pressed', 'false');
    play.textContent = '▶ Spila';
  }
  play.addEventListener('click', () => {
    if (timer !== null) return stop();
    play.setAttribute('aria-pressed', 'true');
    play.textContent = '❚❚ Stöðva';
    timer = window.setInterval(() => {
      if (ti >= times.length - 1) return stop();
      onChange(ti + 1);
    }, 650);
  });

  new ResizeObserver(() => buildTape()).observe(tapeBox);

  return {
    setTimes(t, d, issued) {
      times = t;
      days = d;
      issuedAt = issued;
      buildTape();
    },
    show(i) {
      ti = i;
      const t = times[i];
      if (!t) return;
      dayEl.textContent = dayShort(t);
      timeEl.textContent = hhmm(t);
      const lead = issuedAt ? Math.round((Date.parse(t) - Date.parse(issuedAt)) / 3_600_000) : null;
      runEl.textContent = lead !== null ? `SPÁTÍMI +${lead} KLST` : '';
      tape.setAttribute('aria-valuetext', `${dayShort(t)} kl. ${hhmm(t)}`);
      showNeedle();
    },
    stop,
  };
}
