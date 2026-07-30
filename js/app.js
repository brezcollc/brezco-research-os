/* ============================================================
   app.js — UI controller for Brezco Research OS.
   Talks to the data layer only through `dataStore` (dataStore.js)
   so the storage backend can be swapped in Phase 2 without
   touching any of this rendering / event code.
   ============================================================ */

import { dataStore, CANONICAL_SECTORS } from './dataStore.js';
import { refreshPrices } from './prices.js';

/* ============================================================
   Review Queue thresholds — tweak these freely.
   ============================================================ */
const QUEUE_STALE_MIN_DAYS  = 30;  // only flag "needs review" once this many days stale
const QUEUE_STALE_COUNT     = 8;   // max cards to surface in the stale section
const QUEUE_BIG_MOVE_PCT    = 20;  // |% change since report price| that counts as a big mover
const QUEUE_NEAR_TARGET_PCT = 10;  // live price within this % of target = "approaching target"

/* ---------------- in-memory view state ---------------- */
const state = {
  entries: [],
  activeSector: '__QUEUE__', // default landing view is the Review Queue
  search: '',
  sort: 'recent',      // 'recent' | 'upside' | 'downside' | 'stale'
  ratingFilter: null,  // null (all) | 'BUY' | 'HOLD' | 'SELL' | 'AVOID' | 'N/A'
  statusFilter: null,  // null (all) | 'Holding' | 'Watching' | 'Passed' | 'Unset'
  timelineTicker: null, // when set, main panel shows that ticker's thesis timeline
};

const ALL = '__ALL__';
const QUEUE = '__QUEUE__';

/* ---------------- element handles ---------------- */
const $ = sel => document.querySelector(sel);
const el = {
  statReports: $('#statReports'),
  statSectors: $('#statSectors'),
  statTickers: $('#statTickers'),
  sectorNav: $('#sectorNav'),
  cardGrid: $('#cardGrid'),
  emptyState: $('#emptyState'),
  mainHead: $('#mainHead'),
  timelineView: $('#timelineView'),
  queueView: $('#queueView'),
  sectionTitle: $('#sectionTitle'),
  searchInput: $('#searchInput'),
  lastRefresh: $('#lastRefresh'),
  toastWrap: $('#toastWrap'),
};

/* ============================================================
   Boot
   ============================================================ */
(async function boot() {
  state.entries = await dataStore.init();
  wireStaticEvents();
  populateSectorSelect();
  render();
  showLastRefresh();

  // Surface any sector cleanup the hygiene pass did on this browser's data.
  const fixed = dataStore.lastHygiene();
  if (fixed.length) {
    const n = fixed.length;
    toast(`Cleaned ${n} sector value${n === 1 ? '' : 's'} (duplicates merged / blanks flagged).`, 'ok');
  }
})();

/* ============================================================
   Rendering
   ============================================================ */
function sectorsWithCounts() {
  const map = new Map();
  for (const e of state.entries) {
    const s = e.sector || 'Needs Sector Review';
    map.set(s, (map.get(s) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function uniqueTickerCount() {
  return new Set(state.entries.map(e => e.ticker).filter(t => t && t !== 'MACRO')).size;
}

function render() {
  renderStats();
  renderSectorNav();
  // Leave the timeline if its ticker no longer has any entries (e.g. all deleted).
  if (state.timelineTicker && !state.entries.some(e => e.ticker === state.timelineTicker)) {
    state.timelineTicker = null;
  }
  const mode = state.timelineTicker ? 'timeline'
             : state.activeSector === QUEUE ? 'queue'
             : 'grid';
  el.mainHead.hidden     = mode !== 'grid';
  el.cardGrid.hidden     = mode !== 'grid';
  el.timelineView.hidden = mode !== 'timeline';
  el.queueView.hidden    = mode !== 'queue';
  if (mode !== 'grid') el.emptyState.hidden = true;

  if (mode === 'timeline') renderTimeline(state.timelineTicker);
  else if (mode === 'queue') renderQueue();
  else renderCards();
}

function renderStats() {
  el.statReports.textContent = state.entries.length;
  el.statSectors.textContent = sectorsWithCounts().length;
  el.statTickers.textContent = uniqueTickerCount();
}

function renderSectorNav() {
  const sectors = sectorsWithCounts();
  const frag = document.createDocumentFragment();

  frag.appendChild(sectorButton(QUEUE, '⚡ Review Queue', computeQueue().distinct, false, 'queue'));
  frag.appendChild(sectorButton(ALL, 'All Research', state.entries.length, true));

  const div = document.createElement('div');
  div.className = 'sector-divider';
  frag.appendChild(div);

  for (const [name, count] of sectors) {
    frag.appendChild(sectorButton(name, name, count, false));
  }
  el.sectorNav.replaceChildren(frag);
}

/* cls: optional extra class (e.g. 'queue'). Real sectors (not All/Queue) get a rename pencil. */
function sectorButton(key, label, count, isAll, cls) {
  const isSector = !isAll && key !== QUEUE;
  const btn = document.createElement('div');
  btn.className = 'sector-item' + (isAll ? ' all' : '') + (cls ? ' ' + cls : '')
    + (state.activeSector === key ? ' active' : '');
  btn.setAttribute('role', 'button');
  btn.tabIndex = 0;

  const name = document.createElement('span');
  name.className = 'sector-name';
  name.textContent = label;

  const badge = document.createElement('span');
  badge.className = 'sector-count';
  badge.textContent = count;

  const right = document.createElement('span');
  right.className = 'sector-right';
  if (isSector) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'sector-edit';
    edit.textContent = '✎';
    edit.title = `Rename "${label}" everywhere`;
    edit.setAttribute('aria-label', `Rename sector ${label}`);
    edit.addEventListener('click', ev => { ev.stopPropagation(); openRenameModal(key); });
    right.appendChild(edit);
  }
  right.appendChild(badge);
  btn.append(name, right);

  const activate = () => { state.activeSector = key; state.timelineTicker = null; render(); };
  btn.addEventListener('click', activate);
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  return btn;
}

/* All reports for a real ticker, newest-first. MACRO entries are non-securities,
   so each is its own timeline of one (never grouped with other MACRO pieces). */
function reportsForTicker(ticker) {
  return state.entries.filter(e => e.ticker === ticker).sort(sortEntries);
}

/* Group the whole dataset into ticker-tiles. Each tile: representative entry
   (most recent = the "current view"), the full history, and a count. MACRO
   entries are keyed by id so they stay individual tiles. */
function allTiles() {
  const groups = new Map();
  for (const e of state.entries) {
    const key = e.ticker === 'MACRO' ? 'MACRO::' + e.id : 'T::' + e.ticker;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const tiles = [];
  for (const arr of groups.values()) {
    const sorted = [...arr].sort(sortEntries);
    tiles.push({ rep: sorted[0], entries: sorted, count: sorted.length,
                 grouped: sorted[0].ticker !== 'MACRO' });
  }
  return tiles;
}

/* Tiles visible under the current sector / rating / status / search. Sector,
   rating and status filter on the representative (the "current" call); search
   matches any report in the tile's history. */
function visibleTiles() {
  const q = state.search.trim().toLowerCase();
  return allTiles().filter(t => {
    const rep = t.rep;
    if (state.activeSector !== ALL && rep.sector !== state.activeSector) return false;
    if (state.ratingFilter && rep.rating !== state.ratingFilter) return false;
    if (state.statusFilter && (rep.status || 'Unset') !== state.statusFilter) return false;
    if (!q) return true;
    return t.entries.some(e =>
      (e.ticker + ' ' + e.company + ' ' + e.notes + ' ' + e.sector).toLowerCase().includes(q));
  });
}

/* "3 reports · updated Mar, Jun, Oct" (chronological; year shown if they span). */
function reportsSummary(entries) {
  const n = entries.length;
  const label = `${n} report${n === 1 ? '' : 's'}`;
  const dated = entries.filter(e => e.date).map(e => e.date).sort();
  if (!dated.length) return label;
  const multiYear = new Set(dated.map(d => d.slice(0, 4))).size > 1;
  const fmt = d => {
    const mon = new Date(d + 'T00:00:00').toLocaleString('en-US', { month: 'short' });
    return multiYear ? `${mon} '${d.slice(2, 4)}` : mon;
  };
  let months = dated.map(fmt);
  if (months.length > 4) months = [...months.slice(0, 2), '…', months[months.length - 1]];
  return `${label} · updated ${months.join(', ')}`;
}

function renderCards() {
  el.sectionTitle.textContent = state.activeSector === ALL ? 'All Research' : state.activeSector;

  const cmp = sortComparator();
  const tiles = visibleTiles().sort((a, b) => cmp(a.rep, b.rep));
  el.cardGrid.replaceChildren();

  if (tiles.length === 0) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  const frag = document.createDocumentFragment();
  for (const t of tiles) frag.appendChild(card(t.rep, t));
  el.cardGrid.appendChild(frag);
}

/* ============================================================
   Review Queue — the smart default landing view. Evaluates each
   ticker-tile's representative (most recent report) against the
   thresholds above. A tile can land in more than one section.
   ============================================================ */
function moveSinceReport(e) {           // % change report price -> live price
  return pct(num(e.price), num(e.livePrice));
}
function distanceToTargetPct(e) {       // how far live price is from target, %
  const tg = num(e.target), lp = num(e.livePrice);
  if (tg == null || lp == null || tg === 0) return null;
  return Math.abs(lp - tg) / Math.abs(tg) * 100;
}

function computeQueue() {
  const tiles = allTiles();
  const anyLive = state.entries.some(e => num(e.livePrice) != null);

  const stale = tiles
    .filter(t => {
      const d = daysSinceReviewed(t.rep);
      return d != null && d >= QUEUE_STALE_MIN_DAYS;   // needs a real date, and be old enough
    })
    .sort((a, b) => daysSinceReviewed(b.rep) - daysSinceReviewed(a.rep)) // most stale first
    .slice(0, QUEUE_STALE_COUNT);

  const movers = tiles
    .filter(t => {
      const m = moveSinceReport(t.rep);
      return m != null && Math.abs(m) >= QUEUE_BIG_MOVE_PCT;
    })
    .sort((a, b) => Math.abs(moveSinceReport(b.rep)) - Math.abs(moveSinceReport(a.rep)));

  const near = tiles
    .filter(t => {
      const d = distanceToTargetPct(t.rep);
      return d != null && d <= QUEUE_NEAR_TARGET_PCT;
    })
    .sort((a, b) => distanceToTargetPct(a.rep) - distanceToTargetPct(b.rep)); // closest first

  const distinct = new Set([...stale, ...movers, ...near].map(t => t.rep.id)).size;
  return { stale, movers, near, anyLive, distinct };
}

function renderQueue() {
  const q = computeQueue();
  const view = el.queueView;
  view.replaceChildren();

  const head = document.createElement('div');
  head.className = 'queue-head';
  const h = document.createElement('h2');
  h.className = 'queue-title';
  h.textContent = '⚡ Review Queue';
  const sub = document.createElement('p');
  sub.className = 'queue-sub';
  sub.textContent = 'What needs your attention — stale theses, big moves, and names near target.';
  head.append(h, sub);
  view.appendChild(head);

  if (!q.stale.length && !q.movers.length && !q.near.length) {
    const done = document.createElement('div');
    done.className = 'caught-up';
    done.innerHTML = '<div class="caught-up-mark">✓</div>'
      + '<p class="caught-up-title">You’re caught up</p>'
      + '<p class="caught-up-sub">Nothing needs review right now. Browse by sector from the sidebar, or refresh prices to surface movers.</p>';
    view.appendChild(done);
    return;
  }

  const liveHint = 'Refresh prices (⟳ top bar) to populate this section.';
  view.appendChild(queueSection(
    'Hasn’t Been Reviewed In A While', q.stale,
    `Nothing older than ${QUEUE_STALE_MIN_DAYS} days.`));
  view.appendChild(queueSection(
    'Big Moves Since Report', q.movers,
    q.anyLive ? `Nothing has moved ±${QUEUE_BIG_MOVE_PCT}% since its report.` : liveHint));
  view.appendChild(queueSection(
    'Approaching Target', q.near,
    q.anyLive ? `Nothing within ${QUEUE_NEAR_TARGET_PCT}% of target.` : liveHint));
}

function queueSection(title, tiles, emptyHint) {
  const sec = document.createElement('section');
  sec.className = 'queue-section';

  const h = document.createElement('h3');
  h.className = 'queue-h';
  const label = document.createElement('span');
  label.textContent = title;
  const badge = document.createElement('span');
  badge.className = 'queue-count-badge';
  badge.textContent = tiles.length;
  h.append(label, badge);
  sec.appendChild(h);

  if (tiles.length) {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const t of tiles) grid.appendChild(card(t.rep, t));
    sec.appendChild(grid);
  } else {
    const hint = document.createElement('p');
    hint.className = 'queue-empty-hint';
    hint.textContent = emptyHint;
    sec.appendChild(hint);
  }
  return sec;
}

/* newest-dated first; undated sink to the bottom */
function sortEntries(a, b) {
  const da = a.date || '', db = b.date || '';
  if (da && db) return db.localeCompare(da);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.ticker.localeCompare(b.ticker);
}

/* Pick the active comparator from the sort control. */
function sortComparator() {
  switch (state.sort) {
    case 'upside':   return sortByUpside('upside');
    case 'downside': return sortByUpside('downside');
    case 'stale':    return sortByStale;
    default:         return sortEntries;
  }
}

/* Computed upside/downside % to target, or null if not computable. */
function upsideOf(e) {
  return pct(num(e.price), num(e.target));
}

/* Sort by upside %. Entries with no computable upside always sink to the
   bottom, regardless of direction. dir: 'upside' = highest first,
   'downside' = most negative first. */
function sortByUpside(dir) {
  return (a, b) => {
    const ua = upsideOf(a), ub = upsideOf(b);
    if (ua == null && ub == null) return a.ticker.localeCompare(b.ticker);
    if (ua == null) return 1;   // a → bottom
    if (ub == null) return -1;  // b → bottom
    return dir === 'upside' ? ub - ua : ua - ub;
  };
}

/* most stale first: least-recently-reviewed at the top.
   Undated / never-reviewed entries are treated as infinitely stale. */
function sortByStale(a, b) {
  const va = daysSinceReviewed(a);
  const vb = daysSinceReviewed(b);
  const na = va == null ? Infinity : va;
  const nb = vb == null ? Infinity : vb;
  if (na !== nb) return nb - na; // larger "days ago" (more stale) first
  return a.ticker.localeCompare(b.ticker);
}

/* ---------------- staleness helpers ---------------- */

/* lastReviewed if set, else fall back to the entry's date (no migration write). */
function effectiveReviewed(e) {
  return e.lastReviewed || e.date || '';
}

/* Whole days between a YYYY-MM-DD date and today. null if unparseable/absent. */
function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  if (isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - then) / 86400000);
}

function daysSinceReviewed(e) {
  return daysSince(effectiveReviewed(e));
}

/* Local today as YYYY-MM-DD (matches the <input type="date"> format). */
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/* Severity band → CSS class. <30 grey · 30–90 amber · 90+/never warm-red. */
function staleBand(days) {
  if (days == null) return 'stale-none';
  if (days < 30) return 'stale-fresh';
  if (days < 90) return 'stale-mid';
  return 'stale-old';
}

function reviewedLabel(days) {
  if (days == null) return 'Not yet reviewed';
  if (days <= 0) return 'Reviewed today';
  if (days === 1) return 'Reviewed 1 day ago';
  return `Reviewed ${days} days ago`;
}

function ratingClass(r) {
  return r === 'N/A' ? 'NA' : r;
}

function num(v) {
  if (v == null) return null;
  const cleaned = String(v).replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function fmtPct(p) {
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}

function fmtMoney(v) {
  const n = num(v);
  return n == null ? '—' : '$' + n.toFixed(2);
}

function card(e, tile) {
  const isMacro = e.ticker === 'MACRO';
  const node = document.createElement('article');
  node.className = `card rate-${ratingClass(e.rating)}`;
  node.dataset.id = e.id;

  /* --- top: ticker + company + badge --- */
  const top = document.createElement('div');
  top.className = 'card-top';

  const ident = document.createElement('div');
  ident.className = 'card-ident';
  const tk = document.createElement('div');
  tk.className = 'card-ticker' + (isMacro ? ' macro' : '');
  tk.textContent = isMacro ? 'MACRO' : e.ticker;
  // Clicking the SYMBOL opens the ticker's thesis timeline (background stays edit).
  if (!isMacro) {
    tk.classList.add('clickable');
    tk.title = 'View thesis timeline';
    tk.addEventListener('click', ev => { ev.stopPropagation(); openTimeline(e.ticker); });
  }
  const co = document.createElement('div');
  co.className = 'card-company';
  co.textContent = e.company || '—';
  co.title = e.company || '';
  ident.append(tk, co);

  /* --- multi-report indicator: "3 reports · updated Mar, Jun, Oct" --- */
  if (tile && tile.count > 1) {
    const hist = document.createElement('button');
    hist.type = 'button';
    hist.className = 'card-history';
    hist.textContent = '🕘 ' + reportsSummary(tile.entries);
    hist.title = 'View thesis timeline';
    hist.addEventListener('click', ev => { ev.stopPropagation(); openTimeline(e.ticker); });
    ident.appendChild(hist);
  }

  /* position-status pill — shown only when tagged (not "Unset").
     Cool/neutral palette, deliberately distinct from the rating badge. */
  const status = e.status || 'Unset';
  if (status !== 'Unset') {
    const pill = document.createElement('span');
    pill.className = `status-pill status-${status}`;
    pill.textContent = status;
    pill.title = `Position status: ${status}`;
    ident.appendChild(pill);
  }

  const badge = document.createElement('span');
  badge.className = `badge badge-${ratingClass(e.rating)}`;
  badge.textContent = e.rating;

  top.append(ident, badge);
  node.appendChild(top);

  /* --- notes --- */
  if (e.notes) {
    const notes = document.createElement('p');
    notes.className = 'card-notes';
    notes.textContent = e.notes;
    node.appendChild(notes);
  }

  /* --- price row: report price -> target (upside) --- */
  const p = num(e.price), t = num(e.target);
  if (p != null || t != null) {
    const row = document.createElement('div');
    row.className = 'price-row';

    const from = document.createElement('span');
    from.className = 'price-from';
    from.textContent = fmtMoney(e.price);
    row.appendChild(from);

    if (t != null) {
      const arrow = document.createElement('span');
      arrow.className = 'price-arrow';
      arrow.textContent = '→';
      const to = document.createElement('span');
      to.className = 'price-to';
      to.textContent = fmtMoney(e.target);
      row.append(arrow, to);

      const up = pct(p, t);
      if (up != null) {
        const badgePct = document.createElement('span');
        badgePct.className = 'price-pct ' + (up >= 0 ? 'pct-up' : 'pct-down');
        badgePct.textContent = fmtPct(up);
        badgePct.title = 'Upside/downside to target';
        row.appendChild(badgePct);
      }
    }
    node.appendChild(row);
  }

  /* --- live row (only once fetched) --- */
  const live = num(e.livePrice);
  if (live != null) {
    const row = document.createElement('div');
    row.className = 'live-row';
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    const label = document.createElement('span');
    label.textContent = `Live ${fmtMoney(e.livePrice)}`;
    row.append(dot, label);

    const base = num(e.price);
    const since = pct(base, live);
    if (since != null) {
      const s = document.createElement('span');
      s.className = 'live-since ' + (since >= 0 ? 'up' : 'down');
      s.textContent = `${fmtPct(since)} since report`;
      row.appendChild(s);
    }
    node.appendChild(row);
  }

  /* --- review / staleness row --- */
  const rdays = daysSinceReviewed(e);
  const reviewRow = document.createElement('div');
  reviewRow.className = 'review-row ' + staleBand(rdays);

  const rdot = document.createElement('span');
  rdot.className = 'review-dot';

  const rlabel = document.createElement('span');
  rlabel.className = 'review-label';
  rlabel.textContent = reviewedLabel(rdays);
  if (e.lastReviewed) rlabel.title = 'Last reviewed ' + e.lastReviewed;
  else if (e.date) rlabel.title = 'Never marked reviewed — using report date ' + e.date;

  const markBtn = document.createElement('button');
  markBtn.type = 'button';
  markBtn.className = 'mark-reviewed';
  markBtn.textContent = '✓ Mark reviewed';
  markBtn.title = 'Set last reviewed to today';
  markBtn.addEventListener('click', ev => { ev.stopPropagation(); markReviewed(e.id); });

  reviewRow.append(rdot, rlabel, markBtn);
  node.appendChild(reviewRow);

  /* --- footer: date + open report --- */
  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const date = document.createElement('span');
  date.className = 'card-date';
  date.textContent = e.date || 'No date';
  foot.appendChild(date);

  const link = document.createElement('a');
  link.className = 'card-link' + (e.link ? '' : ' disabled');
  link.textContent = 'Open report →';
  if (e.link) {
    link.href = e.link;
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', ev => ev.stopPropagation());
  }
  foot.appendChild(link);
  node.appendChild(foot);

  node.addEventListener('click', () => openEntryModal(e));
  return node;
}

/* ============================================================
   Ticker thesis timeline
   ============================================================ */
function openTimeline(ticker) {
  state.timelineTicker = ticker;
  render();
  el.timelineView.scrollIntoView({ block: 'start' });
}
function closeTimeline() {
  state.timelineTicker = null;
  render();
}

/* Human-readable diff between an older and a newer report of the same ticker. */
function diffChips(older, newer) {
  const chips = [];
  const rank = { AVOID: 0, SELL: 0, HOLD: 1, 'N/A': 1, BUY: 2 };
  if (older.rating !== newer.rating) {
    const dir = (rank[newer.rating] ?? 1) - (rank[older.rating] ?? 1);
    chips.push({ label: 'Rating', text: `${older.rating} → ${newer.rating}`,
                 cls: dir > 0 ? 'up' : dir < 0 ? 'down' : '' });
  }
  const os = older.status || 'Unset', ns = newer.status || 'Unset';
  if (os !== ns) chips.push({ label: 'Status', text: `${os} → ${ns}`, cls: '' });

  const ot = num(older.target), nt = num(newer.target);
  if (ot !== nt && (ot != null || nt != null)) {
    let text = `${fmtMoney(older.target)} → ${fmtMoney(newer.target)}`;
    const p = pct(ot, nt);
    let cls = '';
    if (p != null) { text += ` (${fmtPct(p)})`; cls = p >= 0 ? 'up' : 'down'; }
    chips.push({ label: 'Target', text, cls });
  }
  const op = num(older.price), np = num(newer.price);
  if (op !== np && (op != null || np != null)) {
    chips.push({ label: 'Price', text: `${fmtMoney(older.price)} → ${fmtMoney(newer.price)}`, cls: '' });
  }
  return chips;
}

function renderTimeline(ticker) {
  const entries = reportsForTicker(ticker);           // newest-first
  const rep = entries[0] || { ticker, company: '', sector: '' };
  const view = el.timelineView;
  view.replaceChildren();

  /* --- header: back, identity, add-new-report --- */
  const head = document.createElement('div');
  head.className = 'tl-head';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'tl-back';
  back.textContent = '← All Research';
  back.addEventListener('click', closeTimeline);

  const idwrap = document.createElement('div');
  idwrap.className = 'tl-id';
  const h = document.createElement('h2');
  h.className = 'tl-ticker';
  h.textContent = ticker;
  const sub = document.createElement('div');
  sub.className = 'tl-sub';
  sub.textContent = `${rep.company || '—'} · ${rep.sector || '—'} · ${entries.length} report${entries.length === 1 ? '' : 's'}`;
  idwrap.append(h, sub);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-gold tl-add';
  addBtn.textContent = `+ Add new report for ${ticker}`;
  addBtn.addEventListener('click', () =>
    openEntryModal(null, { ticker, company: rep.company, sector: rep.sector }));

  head.append(back, idwrap, addBtn);
  view.appendChild(head);

  /* --- vertical timeline: entry, then diff-since-previous, then older entry… --- */
  const list = document.createElement('div');
  list.className = 'tl-list';
  entries.forEach((e, i) => {
    list.appendChild(timelineEntry(e, i === 0));
    const older = entries[i + 1];
    if (older) list.appendChild(timelineDiff(older, e));
  });
  view.appendChild(list);
}

function timelineEntry(e, isCurrent) {
  const row = document.createElement('div');
  row.className = `tl-entry rate-${ratingClass(e.rating)}` + (isCurrent ? ' current' : '');
  row.title = 'Click to edit this report';

  const top = document.createElement('div');
  top.className = 'tl-entry-top';
  const left = document.createElement('div');
  left.className = 'tl-entry-meta';
  const dt = document.createElement('span');
  dt.className = 'tl-date';
  dt.textContent = e.date || 'No date';
  left.appendChild(dt);
  if (isCurrent) {
    const cur = document.createElement('span');
    cur.className = 'tl-current-tag';
    cur.textContent = 'CURRENT';
    left.appendChild(cur);
  }
  const badge = document.createElement('span');
  badge.className = `badge badge-${ratingClass(e.rating)}`;
  badge.textContent = e.rating;
  const status = e.status || 'Unset';
  top.appendChild(left);
  if (status !== 'Unset') {
    const pill = document.createElement('span');
    pill.className = `status-pill status-${status}`;
    pill.textContent = status;
    left.appendChild(pill);
  }
  top.appendChild(badge);
  row.appendChild(top);

  const p = num(e.price), t = num(e.target);
  if (p != null || t != null) {
    const pr = document.createElement('div');
    pr.className = 'tl-price';
    let s = `${fmtMoney(e.price)}`;
    if (t != null) {
      s += ` → ${fmtMoney(e.target)}`;
      const up = pct(p, t);
      if (up != null) s += `  (${fmtPct(up)})`;
    }
    pr.textContent = s;
    row.appendChild(pr);
  }

  if (e.notes) {
    const notes = document.createElement('p');
    notes.className = 'tl-notes';
    notes.textContent = e.notes;
    row.appendChild(notes);
  }

  const foot = document.createElement('div');
  foot.className = 'tl-entry-foot';
  const editHint = document.createElement('span');
  editHint.className = 'tl-edit-hint';
  editHint.textContent = '✎ Edit / delete';
  foot.appendChild(editHint);
  if (e.link) {
    const a = document.createElement('a');
    a.className = 'card-link';
    a.textContent = 'Open report →';
    a.href = e.link; a.target = '_blank'; a.rel = 'noopener';
    a.addEventListener('click', ev => ev.stopPropagation());
    foot.appendChild(a);
  }
  row.appendChild(foot);

  row.addEventListener('click', () => openEntryModal(e));
  return row;
}

function timelineDiff(older, newer) {
  const wrap = document.createElement('div');
  wrap.className = 'tl-diff';
  const chips = diffChips(older, newer);
  if (!chips.length) {
    const none = document.createElement('span');
    none.className = 'tl-diff-none';
    none.textContent = 'notes updated · no rating/price/target change';
    wrap.appendChild(none);
    return wrap;
  }
  for (const c of chips) {
    const chip = document.createElement('span');
    chip.className = 'tl-diff-chip' + (c.cls ? ' ' + c.cls : '');
    const lab = document.createElement('strong');
    lab.textContent = c.label + ': ';
    chip.append(lab, document.createTextNode(c.text));
    wrap.appendChild(chip);
  }
  return wrap;
}

/* ============================================================
   Add / Edit modal
   ============================================================ */
const entryModal = $('#entryModal');
const entryForm = $('#entryForm');

/* Distinct, non-blank sector names currently in the dataset, sorted. */
function existingSectors() {
  const set = new Set();
  for (const e of state.entries) {
    const s = (e.sector || '').trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* The finalized set of sectors offered in the dropdown: the canonical real
   sectors, plus any custom sector already present in the data (so editing an
   entry never silently loses its sector). No vague catch-all is ever offered. */
function sectorChoices() {
  const set = new Set(CANONICAL_SECTORS);
  for (const e of state.entries) {
    const s = (e.sector || '').trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* Builds the dropdown from the finalized sector list + "+ New sector". New
   entries start on a "— Select a sector —" placeholder so a sector must be
   chosen explicitly — there is no default/accidental catch-all. Editing an
   entry (or a pre-filled follow-up) pre-selects its real sector. */
function populateSectorSelect(selected) {
  const sel = $('#f_sectorSelect');
  const sectors = sectorChoices();
  sel.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Select a sector —';
  sel.appendChild(placeholder);

  for (const s of sectors) {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  }
  const nw = document.createElement('option');
  nw.value = '__NEW__';
  nw.textContent = '+ New sector…';
  sel.appendChild(nw);

  const wanted = (selected || '').trim();
  sel.value = (wanted && sectors.includes(wanted)) ? wanted : '';  // else the placeholder
}

/* entry = the record to edit (null to add). prefill = {ticker,company,sector}
   to seed a NEW follow-up report (from a ticker's timeline). */
function openEntryModal(entry, prefill) {
  const editing = !!entry;
  const seed = entry || prefill || {};
  $('#entryModalTitle').textContent = editing ? 'Edit Research'
    : (prefill ? `New report — ${prefill.ticker}` : 'Add Research');
  $('#deleteBtn').hidden = !editing;

  $('#f_id').value = editing ? entry.id : '';
  $('#f_ticker').value = seed.ticker || '';
  $('#f_company').value = seed.company || '';
  $('#f_rating').value = editing ? entry.rating : 'N/A';
  $('#f_status').value = editing ? (entry.status || 'Unset') : 'Unset';
  $('#f_price').value = editing ? entry.price : '';
  $('#f_target').value = editing ? entry.target : '';
  $('#f_link').value = editing ? entry.link : '';
  $('#f_date').value = editing ? entry.date : (prefill ? todayISO() : '');
  $('#f_notes').value = editing ? entry.notes : '';

  populateSectorSelect(seed.sector || '');
  syncNewSectorField();
  updateDupeNote();
  openModal(entryModal);
  $('#f_ticker').focus();
}

/* Non-blocking nudge: if the typed ticker already has prior reports (other than
   the one being edited), surface a note with a link into its timeline. */
function updateDupeNote() {
  const note = $('#dupeNote');
  const ticker = $('#f_ticker').value.trim().toUpperCase();
  const editingId = $('#f_id').value;
  if (!ticker || ticker === 'MACRO') { note.hidden = true; return; }
  const priors = state.entries.filter(e => e.ticker === ticker && e.id !== editingId);
  if (!priors.length) { note.hidden = true; return; }
  note.replaceChildren();
  const txt = document.createTextNode(
    `📎 You have ${priors.length} prior report${priors.length === 1 ? '' : 's'} on ${ticker}. `);
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'View timeline →';
  link.addEventListener('click', ev => {
    ev.preventDefault();
    closeModal(entryModal);
    openTimeline(ticker);
  });
  note.append(txt, link);
  note.hidden = false;
}

function syncNewSectorField() {
  const isNew = $('#f_sectorSelect').value === '__NEW__';
  $('#f_newSectorWrap').hidden = !isNew;
}

async function saveEntry(ev) {
  ev.preventDefault();
  let sector = $('#f_sectorSelect').value;
  if (sector === '__NEW__') sector = $('#f_newSector').value.trim();

  const ticker = $('#f_ticker').value.trim();
  const company = $('#f_company').value.trim();
  if (!ticker || !company || !sector) {
    toast('Ticker, company and sector are required.', 'err');
    return;
  }

  const entry = {
    id: $('#f_id').value || undefined,
    ticker, company, sector,
    rating: $('#f_rating').value,
    status: $('#f_status').value,
    price: $('#f_price').value.trim(),
    target: $('#f_target').value.trim(),
    link: $('#f_link').value.trim(),
    date: $('#f_date').value,
    notes: $('#f_notes').value.trim(),
  };

  // preserve any live-price data on edit
  if (entry.id) {
    const existing = state.entries.find(e => e.id === entry.id);
    if (existing) {
      entry.livePrice = existing.livePrice;
      entry.liveAsOf = existing.liveAsOf;
      entry.lastReviewed = existing.lastReviewed;
    }
  }

  await dataStore.upsert(entry);
  state.entries = await dataStore.getAll();
  closeModal(entryModal);
  render();
  toast(entry.id && $('#f_id').value ? 'Research updated.' : 'Research added.', 'ok');
}

/* Bump an entry back to "fresh" — stamp lastReviewed = today. */
async function markReviewed(id) {
  await dataStore.markReviewed(id, todayISO());
  state.entries = await dataStore.getAll();
  renderCards();
  toast('Marked reviewed today.', 'ok');
}

/* ============================================================
   Rename sector (global) — fix a name once, apply to every entry
   ============================================================ */
const renameModal = $('#renameModal');
let renameOldName = null;

function openRenameModal(sectorName) {
  renameOldName = sectorName;
  const count = state.entries.filter(e => (e.sector || '') === sectorName).length;
  $('#renameOldName').textContent = sectorName;
  $('#renameCount').textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
  const input = $('#f_renameSector');
  input.value = sectorName;
  updateRenameHint();
  openModal(renameModal);
  input.focus();
  input.select();
}

/* Warn when the typed name matches another existing sector (= a merge). */
function updateRenameHint() {
  const target = $('#f_renameSector').value.trim();
  const mergeInto = existingSectors().find(
    s => s.toLowerCase() === target.toLowerCase() && s !== renameOldName
  );
  const note = $('#renameMergeNote');
  if (mergeInto) {
    note.textContent = `Will merge into existing sector “${mergeInto}”.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

async function saveRename() {
  const newName = $('#f_renameSector').value.trim();
  if (!newName) { toast('Sector name can’t be blank.', 'err'); return; }
  if (newName === renameOldName) { closeModal(renameModal); return; }

  const moved = await dataStore.renameSector(renameOldName, newName);
  state.entries = await dataStore.getAll();
  // keep the sidebar selection pointing at the renamed sector if it was active
  if (state.activeSector === renameOldName) state.activeSector = newName;
  closeModal(renameModal);
  render();
  toast(`Renamed to “${newName}” — updated ${moved} ${moved === 1 ? 'entry' : 'entries'}.`, 'ok');
}

async function deleteEntry() {
  const id = $('#f_id').value;
  if (!id) return;
  await dataStore.remove(id);
  state.entries = await dataStore.getAll();
  closeModal(entryModal);
  render();
  toast('Research deleted.', 'ok');
}

/* ============================================================
   Import modal ("Paste from Claude")
   ============================================================ */
const importModal = $('#importModal');

function openImportModal() {
  $('#importText').value = '';
  $('#importError').hidden = true;
  openModal(importModal);
  $('#importText').focus();
}

function validateImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: 'Invalid JSON — could not parse.\n' + err.message };
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  if (arr.length === 0) return { error: 'No entries found.' };

  const valid = [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (o == null || typeof o !== 'object' || Array.isArray(o)) {
      return { error: `Entry #${i + 1} is not an object.` };
    }
    const miss = ['ticker', 'company', 'sector'].filter(k => !o[k] || !String(o[k]).trim());
    if (miss.length) {
      return { error: `Entry #${i + 1} is missing required field(s): ${miss.join(', ')}.` };
    }
    valid.push(o);
  }
  return { valid };
}

async function submitImport() {
  const text = $('#importText').value.trim();
  const errBox = $('#importError');
  if (!text) { errBox.textContent = 'Paste some JSON first.'; errBox.hidden = false; return; }

  const { valid, error } = validateImport(text);
  if (error) { errBox.textContent = error; errBox.hidden = false; return; }

  // Non-blocking nudge: which imported tickers already had prior reports?
  const existingTickers = new Set(state.entries.map(e => e.ticker));
  const followUps = [...new Set(valid
    .map(o => String(o.ticker).trim().toUpperCase())
    .filter(t => t && t !== 'MACRO' && existingTickers.has(t)))];

  await dataStore.bulkUpsert(valid);
  state.entries = await dataStore.getAll();
  closeModal(importModal);
  render();
  toast(`Imported ${valid.length} ${valid.length === 1 ? 'entry' : 'entries'}.`, 'ok');
  if (followUps.length) {
    const names = followUps.slice(0, 4).join(', ') + (followUps.length > 4 ? '…' : '');
    toast(`Added to existing timelines: ${names}. Click a ticker symbol to see history.`, '');
  }
}

/* ============================================================
   Settings modal + live price refresh
   ============================================================ */
const settingsModal = $('#settingsModal');

async function openSettingsModal() {
  $('#f_apiKey').value = (await dataStore.getSetting('finnhubKey')) || '';
  openModal(settingsModal);
}

async function saveSettings() {
  await dataStore.setSetting('finnhubKey', $('#f_apiKey').value.trim());
  closeModal(settingsModal);
  toast('Settings saved.', 'ok');
}

async function exportData() {
  const data = JSON.stringify(await dataStore.getAll(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `brezco-research-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function doRefresh() {
  const key = (await dataStore.getSetting('finnhubKey')) || '';
  if (!key) {
    toast('Add a Finnhub API key to refresh prices.', 'err');
    openSettingsModal();
    return;
  }

  const tickers = state.entries.map(e => e.ticker);
  const btn = $('#refreshBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-ico spin">⟳</span> Refreshing…';

  const result = await refreshPrices(tickers, key, async (ticker, price, asOf) => {
    await dataStore.applyLivePrice(ticker, price, asOf);
  });

  state.entries = await dataStore.getAll();
  await dataStore.setSetting('lastRefresh', new Date().toISOString());
  render();
  showLastRefresh();

  btn.disabled = false;
  btn.innerHTML = original;

  if (result.failed === 0) {
    toast(`Refreshed ${result.succeeded} ticker${result.succeeded === 1 ? '' : 's'}.`, 'ok');
  } else {
    const names = result.failures.slice(0, 4).map(f => f.ticker).join(', ');
    const more = result.failures.length > 4 ? '…' : '';
    toast(`${result.succeeded} updated, ${result.failed} failed (${names}${more}).`, result.succeeded ? '' : 'err');
  }
}

async function showLastRefresh() {
  const iso = await dataStore.getSetting('lastRefresh');
  if (!iso) { el.lastRefresh.textContent = 'Prices not yet refreshed'; return; }
  const d = new Date(iso);
  el.lastRefresh.textContent = 'Prices as of ' + d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ============================================================
   Modal helpers
   ============================================================ */
function openModal(m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(m) { m.hidden = true; document.body.style.overflow = ''; }

/* ============================================================
   Toast
   ============================================================ */
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  el.toastWrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

/* ============================================================
   Static event wiring
   ============================================================ */
function wireStaticEvents() {
  $('#addBtn').addEventListener('click', () => openEntryModal(null));
  $('#importBtn').addEventListener('click', openImportModal);
  $('#settingsBtn').addEventListener('click', openSettingsModal);
  $('#refreshBtn').addEventListener('click', doRefresh);

  entryForm.addEventListener('submit', saveEntry);
  $('#deleteBtn').addEventListener('click', deleteEntry);
  $('#f_sectorSelect').addEventListener('change', syncNewSectorField);
  $('#f_ticker').addEventListener('input', updateDupeNote);

  $('#importSubmit').addEventListener('click', submitImport);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#exportDataBtn').addEventListener('click', exportData);

  $('#renameSaveBtn').addEventListener('click', saveRename);
  $('#f_renameSector').addEventListener('input', updateRenameHint);
  $('#f_renameSector').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } });

  el.searchInput.addEventListener('input', e => { state.search = e.target.value; renderCards(); });
  $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; renderCards(); });
  $('#statusFilter').addEventListener('change', e => { state.statusFilter = e.target.value || null; renderCards(); });

  // rating filter chips (single-select; empty data-rating = "All")
  document.querySelectorAll('#ratingFilter .chip').forEach(chip =>
    chip.addEventListener('click', () => {
      state.ratingFilter = chip.dataset.rating || null;
      document.querySelectorAll('#ratingFilter .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderCards();
    }));

  // close buttons + backdrop click + Esc
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => closeAllModals()));
  document.querySelectorAll('.modal-backdrop').forEach(bd =>
    bd.addEventListener('click', e => { if (e.target === bd) closeAllModals(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}

function closeAllModals() {
  [entryModal, importModal, settingsModal, renameModal].forEach(closeModal);
}
