// Server-rendered list of all active IMO weather stations (/stodvar).
// The station dialog links here, because the new vedur.is has no page that
// lists every station with its number.

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderStationList({ stations, fetchedAt }) {
  const groups = new Map();
  for (const s of stations) {
    if (!groups.has(s.region)) groups.set(s.region, []);
    groups.get(s.region).push(s);
  }

  const sections = [...groups]
    .map(
      ([region, list]) => `
    <section data-region>
      <h2>${esc(region)} <span class="count">${list.length}</span></h2>
      <table>
        <thead><tr><th class="num">Númer</th><th>Nafn</th><th>Gerð</th><th class="num">Hæð</th><th>Eigandi</th></tr></thead>
        <tbody>${list
          .map(
            (s) => `
          <tr data-search="${esc(`${s.id} ${s.name} ${s.region}`.toLowerCase())}">
            <td class="num id">${s.id}</td>
            <td><a href="https://www.vedur.is/vedur/athuganir/${s.id}/" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></td>
            <td>${esc(s.type)}</td>
            <td class="num">${s.elevation === null ? '—' : `${s.elevation} m`}</td>
            <td class="owner">${esc(s.owner ?? '—')}</td>
          </tr>`,
          )
          .join('')}
        </tbody>
      </table>
    </section>`,
    )
    .join('');

  const stamp = new Date(fetchedAt).toLocaleString('is-IS', { timeZone: 'Atlantic/Reykjavik' });

  return `<!doctype html>
<html lang="is">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Veðurstöðvar · Veðurstöð Turbo</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>
  :root {
    color-scheme: dark;
    --bg: #0f0b09;
    --panel: #1a1614;
    --edge: #2a231e;
    --label: #d6c7a9;
    --label-dim: #877762;
    --amber: #f5a623;
    --amber-dim: #a0610d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 48px;
    background: var(--bg);
    color: var(--label);
    font: 14px/1.45 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 18px; letter-spacing: 0.24em; text-transform: uppercase; margin: 0 0 8px; color: #ead9b5; }
  p { margin: 0 0 16px; color: var(--label-dim); }
  a { color: var(--amber); text-decoration-color: var(--amber-dim); }
  .search {
    position: sticky; top: 0; z-index: 1;
    padding: 12px 0; background: var(--bg);
  }
  input[type=search] {
    width: 100%; padding: 10px 12px;
    background: #1a0e05; color: var(--amber);
    border: 1px solid var(--edge); border-radius: 4px;
    font: inherit; font-size: 16px;
  }
  input[type=search]:focus { outline: 1px solid var(--amber); outline-offset: 1px; }
  section { margin-top: 20px; }
  h2 {
    font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--label-dim); margin: 0 0 6px; padding-bottom: 4px;
    border-bottom: 1px solid var(--edge);
  }
  .count { color: var(--amber-dim); }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th:nth-child(1) { width: 80px; }
  th:nth-child(3) { width: 110px; }
  th:nth-child(4) { width: 80px; }
  th:nth-child(5) { width: 30%; }
  td { overflow-wrap: anywhere; }
  th { text-align: left; font-weight: 400; font-size: 11px; color: var(--label-dim); padding: 4px 8px; }
  td { padding: 5px 8px; border-top: 1px solid #1d1815; vertical-align: top; }
  tbody tr:hover { background: var(--panel); }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .id { color: var(--amber); font-weight: 600; }
  .owner { color: var(--label-dim); font-size: 12px; }
  .empty { display: none; margin-top: 24px; }
  @media (max-width: 640px) {
    th:nth-child(3), td:nth-child(3), th:nth-child(5), td:nth-child(5) { display: none; }
  }
</style>
</head>
<body>
<main>
  <h1>Veðurstöðvar</h1>
  <p>
    ${stations.length} virkar veðurstöðvar Veðurstofunnar. Sláðu stöðvarnúmerið inn í
    <a href="/">Veðurstöð Turbo</a> til að bæta stöðinni við sem flipa.
    Heiti stöðvar opnar síðu hennar á vedur.is. Gögn: api.vedur.is, sótt ${esc(stamp)}.
  </p>
  <div class="search">
    <input type="search" id="q" placeholder="Leita eftir nafni, númeri eða svæði" autocomplete="off" autofocus />
  </div>
  ${sections}
  <p class="empty" id="empty">Engin stöð passar við leitina.</p>
</main>
<script>
  const q = document.getElementById('q');
  const rows = [...document.querySelectorAll('tbody tr')];
  const sections = [...document.querySelectorAll('section[data-region]')];
  const empty = document.getElementById('empty');
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    for (const r of rows) r.hidden = term !== '' && !r.dataset.search.includes(term);
    let any = false;
    for (const s of sections) {
      const shown = s.querySelectorAll('tbody tr:not([hidden])').length > 0;
      s.hidden = !shown;
      any ||= shown;
    }
    empty.style.display = any ? 'none' : 'block';
  });
</script>
</body>
</html>
`;
}
