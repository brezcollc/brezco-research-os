/* ============================================================
   app.js — UI controller for Brezco Research OS.
   Talks to the data layer only through `dataStore` (dataStore.js).
   Every derived number shown in the UI (upside, move since report,
   probability-weighted target) is a CALCULATION from stored fields
   and is labeled as such — nothing here fetches or invents data.
   ============================================================ */

import { dataStore, CANONICAL_SECTORS, auth, IS_DEMO } from './dataStore.js?v=20260928a';
import { PROMPT_TYPES, buildPrompt } from './prompts.js?v=20260928a';

/* ============================================================
   Review Queue thresholds — tweak these freely.
   ============================================================ */
const QUEUE_STALE_MIN_DAYS  = 30;  // only flag "needs review" once this many days stale
const QUEUE_SECTION_CAP     = 6;   // cards shown per section before "+N more"
const QUEUE_BIG_MOVE_PCT    = 20;  // |% change since report price| that counts as a big mover
const QUEUE_NEAR_TARGET_PCT = 10;  // live price within this % of target = "approaching target"
const QUEUE_REVIEW_SNOOZE_DAYS = 7; // "Mark reviewed" hides near-target / big-move alerts this long

/* Review-queue status priority. Watching floats to the top: Ian tracks his
   holdings daily in his brokerage, so it's the watchlist names he loses track
   of that the queue should surface first. */
const QUEUE_STATUS_PRIORITY = { Watching: 0, Holding: 1, Unset: 2, Passed: 3 };
function queueStatusRank(e) {
  return QUEUE_STATUS_PRIORITY[e.status || 'Unset'] ?? 2;
}

/* ---------------- in-memory view state ---------------- */
const state = {
  entries: [],
  activeSector: '__QUEUE__', // default landing view is the Review Queue
  search: '',
  sort: { key: 'upside', dir: -1 }, // see SORT_KEYS; table headers + preset menu
  view: 'table',       // 'table' | 'cards' (grid mode), remembered per device
  ratingFilter: null,  // null (all) | 'BUY' | 'HOLD' | 'SELL' | 'AVOID' | 'N/A'
  statusFilter: null,  // null (all) | 'Holding' | 'Watching' | 'Passed' | 'Unset'
  timelineTicker: null, // when set, main panel shows that ticker's thesis timeline
  priceRefreshDone: false, // has a live-price refresh run in this browser yet
  userEmail: '',           // signed-in account email
  queueWatchingOnly: false,        // review-queue filter: show only Watching names
  queueExpanded: { intel: false, near: false, movers: false, stale: false }, // per-section "+N more"
};

const ALL = '__ALL__';
const QUEUE = '__QUEUE__';

/* ---------------- element handles ---------------- */
const $ = sel => document.querySelector(sel);
const el = {
  statTickers: $('#statTickers'),
  statHolding: $('#statHolding'),
  statWatching: $('#statWatching'),
  statQueue: $('#statQueue'),
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
  const user = await auth.currentUser();
  if (!user) { showLogin(); return; }
  await startApp(user);
})();

async function startApp(user) {
  state.entries = await dataStore.init();
  state.priceRefreshDone = !!(await dataStore.getSetting('lastRefresh'));
  state.userEmail = user?.email || '';
  // Remember the queue's "Watching only" toggle between visits (per-device).
  try { state.queueWatchingOnly = localStorage.getItem('brezco.queue.watchingOnly') === '1'; } catch {}
  loadViewPrefs();
  if (IS_DEMO) document.body.classList.add('demo');
  wireStaticEvents();
  populateSectorSelect();
  render();
  showLastRefresh();
  // reflect a sign-out (from this or another tab) by returning to the login screen
  auth.onChange(session => { if (!session) location.reload(); });

  // Surface any sector cleanup the hygiene pass did.
  const fixed = dataStore.lastHygiene();
  if (fixed.length) {
    const n = fixed.length;
    toast(`Cleaned ${n} sector value${n === 1 ? '' : 's'} (duplicates merged / blanks flagged).`, 'ok');
  }
}

/* Table/cards choice + sort, remembered per device. */
function saveViewPrefs() {
  try { localStorage.setItem('brezco.view', JSON.stringify({ view: state.view, sort: state.sort })); } catch {}
}
function loadViewPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('brezco.view') || 'null');
    if (p && (p.view === 'table' || p.view === 'cards')) state.view = p.view;
    if (p && p.sort && SORT_KEYS[p.sort.key] && (p.sort.dir === 1 || p.sort.dir === -1)) state.sort = p.sort;
  } catch {}
}

/* Passwordless login gate — shown until a session exists. */
function showLogin() {
  const gate = $('#authGate');
  const email = $('#authEmail');
  const btn = $('#authSendBtn');
  const msg = $('#authMsg');
  gate.hidden = false;

  const setMsg = (t, kind) => { msg.textContent = t; msg.className = 'auth-msg ' + (kind || ''); msg.hidden = false; };
  const send = async () => {
    const addr = email.value.trim();
    if (!addr.includes('@')) { setMsg('Enter a valid email address.', 'err'); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    const { error } = await auth.sendMagicLink(addr);
    btn.disabled = false; btn.textContent = 'Email me a login link';
    if (error) { setMsg('Could not send link: ' + error.message, 'err'); return; }
    setMsg('✓ Check your email for a one-time login link — open it on this device.', 'ok');
  };
  btn.addEventListener('click', send);
  email.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  email.focus();

  // if a session shows up (e.g. link opened, URL processed), enter the app
  auth.onChange(session => { if (session) location.reload(); });
}

async function signOut() {
  await auth.signOut();
  location.reload();
}

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
  const reps = allTiles().map(t => t.rep).filter(e => e.ticker !== 'MACRO');
  el.statTickers.textContent = reps.length;
  el.statHolding.textContent = reps.filter(e => e.status === 'Holding').length;
  el.statWatching.textContent = reps.filter(e => e.status === 'Watching').length;
  el.statQueue.textContent = computeQueue().distinct;
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
      (e.ticker + ' ' + e.company + ' ' + e.notes + ' ' + e.sector + ' ' +
       ((e.thesis && e.thesis.one_liner) || '')).toLowerCase().includes(q));
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
  document.querySelectorAll('#viewToggle button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === state.view));
  const preset = Object.entries(SORT_PRESETS)
    .find(([, v]) => v.key === state.sort.key && v.dir === state.sort.dir);
  $('#sortSelect').value = preset ? preset[0] : '';

  const cmp = sortComparator();
  const tiles = visibleTiles().sort((a, b) => cmp(a.rep, b.rep));
  el.cardGrid.replaceChildren();
  el.cardGrid.classList.toggle('as-table', state.view === 'table');

  if (tiles.length === 0) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  if (state.view === 'table') {
    el.cardGrid.appendChild(researchTable(tiles));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const t of tiles) frag.appendChild(card(t.rep, t));
  el.cardGrid.appendChild(frag);
}

/* ============================================================
   Table view — one dense, sortable row per ticker. The scanning
   view: what's cheap/expensive vs. target right now, what's
   moving, what's next, what's gone stale.
   ============================================================ */
const TABLE_COLS = [
  { key: 'ticker',     label: 'Ticker' },
  { key: 'status',     label: 'Status' },
  { key: 'rating',     label: 'Call' },
  { key: 'live',       label: 'Live',        num: true },
  { key: 'target',     label: 'Target',      num: true },
  { key: 'upside',     label: 'To target',   num: true, title: 'CALC: live price → target (report price if no live quote)' },
  { key: 'since',      label: 'Since report', num: true, title: 'CALC: report-day price → live price' },
  { key: 'conviction', label: 'Conv.',       num: true },
  { key: 'catalyst',   label: 'Next catalyst' },
  { key: 'reviewed',   label: 'Reviewed',    num: true },
];

function researchTable(tiles) {
  const wrap = document.createElement('div');
  wrap.className = 'rt-wrap';
  const table = document.createElement('table');
  table.className = 'rt';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of TABLE_COLS) {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.num) th.className = 'num';
    if (c.title) th.title = c.title;
    if (state.sort.key === c.key) th.classList.add('sorted', state.sort.dir > 0 ? 'asc' : 'desc');
    th.addEventListener('click', () => {
      const same = state.sort.key === c.key;
      // first click: the "interesting" direction (high upside, soonest catalyst…)
      const firstDir = ['ticker', 'status', 'rating', 'catalyst'].includes(c.key) ? 1 : -1;
      state.sort = { key: c.key, dir: same ? -state.sort.dir : firstDir };
      saveViewPrefs();
      renderCards();
    });
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const t of tiles) tbody.appendChild(tableRow(t.rep, t));
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function td(text, cls, title) {
  const c = document.createElement('td');
  c.textContent = text;
  if (cls) c.className = cls;
  if (title) c.title = title;
  return c;
}

function tableRow(e, tile) {
  const tr = document.createElement('tr');
  const isMacro = e.ticker === 'MACRO';

  const id = document.createElement('td');
  id.className = 'rt-id';
  const tk = document.createElement('span');
  tk.className = 'rt-ticker';
  tk.textContent = isMacro ? 'MACRO' : e.ticker;
  const co = document.createElement('span');
  co.className = 'rt-co';
  co.textContent = e.company || '';
  id.append(tk, co);
  const conflict = callConflict(e);
  if (conflict) {
    const w = document.createElement('span');
    w.className = 'rt-flag';
    w.textContent = '⚠';
    w.title = conflict;
    id.appendChild(w);
  }
  tr.appendChild(id);

  const st = e.status || 'Unset';
  const stCell = document.createElement('td');
  if (st !== 'Unset') {
    const pill = document.createElement('span');
    pill.className = `status-pill status-${st}`;
    pill.textContent = st;
    stCell.appendChild(pill);
  }
  tr.appendChild(stCell);

  const rc = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge badge-${ratingClass(e.rating)}`;
  badge.textContent = e.rating;
  rc.appendChild(badge);
  tr.appendChild(rc);

  const live = liveFor(e.ticker);
  tr.appendChild(td(live ? fmtMoney(live.price) : '—', 'num',
    live && live.asOf ? 'Feed price as of ' + new Date(live.asOf).toLocaleString() : 'No feed price yet'));
  tr.appendChild(td(fmtMoney(e.target), 'num'));

  const upN = upsideNow(e), upR = upsideAtReport(e);
  if (upN != null) tr.appendChild(td(fmtPct(upN), 'num ' + (upN >= 0 ? 'pos' : 'neg'), 'CALC: live → target'));
  else if (upR != null) tr.appendChild(td(fmtPct(upR), 'num dim', 'CALC: report price → target (no live quote)'));
  else tr.appendChild(td('—', 'num dim'));

  const sr = sinceReport(e);
  tr.appendChild(td(sr == null ? '—' : fmtPct(sr), 'num ' + (sr == null ? 'dim' : sr >= 0 ? 'pos' : 'neg')));

  const conv = e.thesis && e.thesis.conviction;
  tr.appendChild(td(conv ? '●'.repeat(conv) + '○'.repeat(5 - conv) : '—', 'num conv'));

  const cat = nextCatalyst(e);
  tr.appendChild(cat
    ? td(`${cat.event} · ${whenLabel(cat.days)}`, 'rt-cat' + (cat.days <= 14 ? ' soon' : ''), cat.matters_because || cat.date)
    : td('—', 'dim'));

  const rd = daysSinceReviewed(e);
  tr.appendChild(td(rd == null ? 'never' : rd <= 0 ? 'today' : `${rd}d`, 'num ' + staleBand(rd)));

  tr.title = tile && tile.count > 1 ? `${tile.count} reports — click for company page` : 'Click for company page';
  tr.addEventListener('click', () => isMacro ? openEntryModal(e) : openTimeline(e.ticker));
  return tr;
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

  const near = [], movers = [], stale = [];
  for (const t of tiles) {
    const dTarget = distanceToTargetPct(t.rep);
    const mv = moveSinceReport(t.rep);
    const days = daysSinceReviewed(t.rep);
    // Price alerts are snoozed for a few days after an explicit "Mark reviewed",
    // so acknowledging a tile actually clears it from the queue.
    const reviewedDays = t.rep.lastReviewed ? daysSince(t.rep.lastReviewed) : null;
    const snoozed = reviewedDays != null && reviewedDays < QUEUE_REVIEW_SNOOZE_DAYS;
    const isNear  = !snoozed && dTarget != null && dTarget <= QUEUE_NEAR_TARGET_PCT;
    const isMover = !snoozed && mv != null && Math.abs(mv) >= QUEUE_BIG_MOVE_PCT;
    const isStale = days != null && days >= QUEUE_STALE_MIN_DAYS;
    if (!isNear && !isMover && !isStale) continue;

    // Tag EVERY reason that applies, so a card's secondary reasons stay visible
    // even though it's routed to a single section below.
    t.queueReasons = { isNear, isMover, isStale, dTarget, mv, days };

    // One name, one place — route by urgency: near target > big move > stale.
    if (isNear) near.push(t);
    else if (isMover) movers.push(t);
    else stale.push(t);
  }

  // Watching-first within each section, then the section's own metric.
  near.sort((a, b) => queueStatusRank(a.rep) - queueStatusRank(b.rep)
    || a.queueReasons.dTarget - b.queueReasons.dTarget);            // closest to target first
  movers.sort((a, b) => queueStatusRank(a.rep) - queueStatusRank(b.rep)
    || Math.abs(b.queueReasons.mv) - Math.abs(a.queueReasons.mv));  // biggest move first
  stale.sort((a, b) => queueStatusRank(a.rep) - queueStatusRank(b.rep)
    || b.queueReasons.days - a.queueReasons.days);                  // most stale first

  const intel = computeIntel(tiles);

  // Distinct tickers needing attention (cards + decision items). Drives the
  // sidebar badge and is deliberately NOT affected by the Watching-only filter.
  const names = new Set([...near, ...movers, ...stale].map(t => t.rep.ticker + t.rep.id));
  for (const i of intel) names.add(i.tile.rep.ticker + i.tile.rep.id);
  return { stale, movers, near, intel, anyLive, distinct: names.size };
}

/* ============================================================
   Decision items — what the stored theses say needs action NOW.
   Sourced only from your own thesis JSON + the price feed:
     • broken assumptions        • rating contradicts live upside
     • prediction due / overdue  • scheduled review date reached
     • dated catalyst ≤ 21 days
   "Mark reviewed" snoozes all but catalysts for a few days.
   ============================================================ */
const INTEL_CATALYST_DAYS = 21;
const INTEL_PREDICTION_DAYS = 14;
const INTEL_ORDER = { risk: 0, conflict: 1, prediction: 2, review: 3, catalyst: 4 };

function computeIntel(tiles) {
  const items = [];
  for (const tile of tiles) {
    const e = tile.rep;
    if (e.ticker === 'MACRO' || e.status === 'Passed') continue;
    const t = e.thesis || {};
    const rd = e.lastReviewed ? daysSince(e.lastReviewed) : null;
    const snoozed = rd != null && rd < QUEUE_REVIEW_SNOOZE_DAYS;

    if (!snoozed) {
      const broken = (t.assumptions || []).filter(a => a.status === 'broken');
      if (broken.length) items.push({ tile, kind: 'risk', label: 'Thesis at risk',
        text: `${broken.length} broken assumption${broken.length > 1 ? 's' : ''}: ${broken[0].claim}`, days: null });

      const conflict = callConflict(e);
      if (conflict) items.push({ tile, kind: 'conflict', label: 'Stale call', text: conflict, days: null });

      const pd = t.prediction && t.prediction.statement ? daysUntil(t.prediction.by) : null;
      if (pd != null && pd <= INTEL_PREDICTION_DAYS) items.push({ tile, kind: 'prediction',
        label: pd < 0 ? 'Grade prediction' : 'Prediction due', text: t.prediction.statement, days: pd });

      const nr = daysUntil(t.next_review);
      if (nr != null && nr <= 0) items.push({ tile, kind: 'review', label: 'Review scheduled',
        text: t.one_liner || e.notes || 'Scheduled thesis review', days: nr });
    }

    for (const c of t.catalysts || []) {
      const d = daysUntil(c.date);
      if (d != null && d >= 0 && d <= INTEL_CATALYST_DAYS) items.push({ tile, kind: 'catalyst',
        label: 'Catalyst', text: c.event + (c.matters_because ? ' — ' + c.matters_because : ''), days: d });
    }
  }
  items.sort((a, b) => (INTEL_ORDER[a.kind] - INTEL_ORDER[b.kind])
    || queueStatusRank(a.tile.rep) - queueStatusRank(b.tile.rep)
    || (a.days ?? 0) - (b.days ?? 0));
  return items;
}

function intelSection(items) {
  const sec = document.createElement('section');
  sec.className = 'queue-section intel';
  const h = document.createElement('h3');
  h.className = 'queue-h';
  const label = document.createElement('span');
  label.textContent = 'Decisions Due';
  const badge = document.createElement('span');
  badge.className = 'queue-count-badge';
  badge.textContent = items.length;
  h.append(label, badge);
  sec.appendChild(h);

  if (!items.length) {
    const hint = document.createElement('p');
    hint.className = 'queue-empty-hint';
    hint.textContent = 'Nothing from your theses needs a decision. Items appear here from broken assumptions, '
      + 'predictions coming due, scheduled reviews, dated catalysts, and calls the live price contradicts.';
    sec.appendChild(hint);
    return sec;
  }
  const list = document.createElement('div');
  list.className = 'intel-list';
  const expanded = !!state.queueExpanded.intel;
  const shown = expanded ? items : items.slice(0, 10);
  for (const it of shown) {
    const row = document.createElement('div');
    row.className = 'intel-row';
    row.tabIndex = 0;
    const tk = document.createElement('span');
    tk.className = 'intel-ticker';
    tk.textContent = it.tile.rep.ticker;
    const kind = document.createElement('span');
    kind.className = 'intel-kind intel-' + it.kind;
    kind.textContent = it.label;
    const text = document.createElement('span');
    text.className = 'intel-text';
    text.textContent = it.text;
    const when = document.createElement('span');
    when.className = 'intel-when' + (it.days != null && it.days < 0 ? ' overdue' : '');
    when.textContent = whenLabel(it.days);
    row.append(tk, kind, text, when);
    const open = () => openTimeline(it.tile.rep.ticker);
    row.addEventListener('click', open);
    row.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
    list.appendChild(row);
  }
  sec.appendChild(list);
  if (items.length > 10) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'queue-more';
    more.textContent = expanded ? '▲ Show fewer' : `+ ${items.length - 10} more`;
    more.addEventListener('click', () => { state.queueExpanded.intel = !expanded; renderQueue(); });
    sec.appendChild(more);
  }
  return sec;
}

function renderQueue() {
  const q = computeQueue();
  const view = el.queueView;
  view.replaceChildren();

  const head = document.createElement('div');
  head.className = 'queue-head';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'queue-titlewrap';
  const h = document.createElement('h2');
  h.className = 'queue-title';
  h.textContent = '⚡ Review Queue';
  const sub = document.createElement('p');
  sub.className = 'queue-sub';
  sub.textContent = 'What needs a decision, what is near target or moving, and what has gone stale.';
  titleWrap.append(h, sub);

  // "Watching only" toggle — one click to hide holdings/passed and focus on
  // the watchlist names (the ones easy to lose track of). Persists per-device.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'queue-toggle' + (state.queueWatchingOnly ? ' on' : '');
  toggle.textContent = state.queueWatchingOnly ? '👁 Watching only · ON' : '👁 Watching only';
  toggle.title = 'Show only names you are Watching';
  toggle.addEventListener('click', () => {
    state.queueWatchingOnly = !state.queueWatchingOnly;
    try { localStorage.setItem('brezco.queue.watchingOnly', state.queueWatchingOnly ? '1' : ''); } catch {}
    renderQueue();
  });
  head.append(titleWrap, toggle);
  view.appendChild(head);

  // Apply the Watching-only view filter (the sidebar badge stays the full count).
  const filt = list => state.queueWatchingOnly
    ? list.filter(t => (t.rep.status || 'Unset') === 'Watching')
    : list;
  const near = filt(q.near), movers = filt(q.movers), stale = filt(q.stale);
  const intel = state.queueWatchingOnly
    ? q.intel.filter(i => (i.tile.rep.status || 'Unset') === 'Watching') : q.intel;

  if (!stale.length && !movers.length && !near.length && !intel.length) {
    const done = document.createElement('div');
    done.className = 'caught-up';
    const extra = state.queueWatchingOnly
      ? 'No Watching names need review right now. Turn off “Watching only” to see holdings and passed names too.'
      : 'Nothing needs review right now. Browse by sector from the sidebar, or refresh prices to surface movers.';
    done.innerHTML = '<div class="caught-up-mark">✓</div>'
      + '<p class="caught-up-title">You’re caught up</p>'
      + `<p class="caught-up-sub">${extra}</p>`;
    view.appendChild(done);
    return;
  }

  const liveHint = 'Refresh prices (⟳ top bar) to populate this section.';
  view.appendChild(intelSection(intel));
  view.appendChild(queueSection(
    'Approaching Target', near, 'near',
    q.anyLive ? `Nothing within ${QUEUE_NEAR_TARGET_PCT}% of target.` : liveHint));
  view.appendChild(queueSection(
    'Big Moves Since Report', movers, 'movers',
    q.anyLive ? `Nothing has moved ±${QUEUE_BIG_MOVE_PCT}% since its report.` : liveHint));
  view.appendChild(queueSection(
    'Hasn’t Been Reviewed In A While', stale, 'stale',
    `Nothing older than ${QUEUE_STALE_MIN_DAYS} days.`));
}

function queueSection(title, tiles, key, emptyHint) {
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
    const expanded = !!state.queueExpanded[key];
    const shown = expanded ? tiles : tiles.slice(0, QUEUE_SECTION_CAP);
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const t of shown) grid.appendChild(card(t.rep, t));
    sec.appendChild(grid);

    if (tiles.length > QUEUE_SECTION_CAP) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'queue-more';
      more.textContent = expanded
        ? '▲ Show fewer'
        : `+ ${tiles.length - QUEUE_SECTION_CAP} more`;
      more.addEventListener('click', () => {
        state.queueExpanded[key] = !expanded;
        renderQueue();
      });
      sec.appendChild(more);
    }
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

/* ---------------- sorting (shared by table + cards) ----------------
   state.sort = { key, dir }. Missing values always sink to the bottom. */
const RATING_RANK = { BUY: 0, HOLD: 1, 'N/A': 2, SELL: 3, AVOID: 4 };
const SORT_KEYS = {
  ticker:     e => e.ticker,
  status:     e => queueStatusRank(e),
  rating:     e => RATING_RANK[e.rating] ?? 2,
  live:       e => liveOf(e),
  target:     e => num(e.target),
  upside:     e => upsideNow(e) ?? upsideAtReport(e),
  since:      e => sinceReport(e),
  conviction: e => (e.thesis && e.thesis.conviction) ?? null,
  catalyst:   e => { const c = nextCatalyst(e); return c ? c.days : null; },
  reviewed:   e => daysSinceReviewed(e),
  date:       e => e.date || null,
};
/* The sidebar-style presets map onto a key + direction. */
const SORT_PRESETS = {
  recent:   { key: 'date',     dir: -1 },
  upside:   { key: 'upside',   dir: -1 },
  downside: { key: 'upside',   dir: 1 },
  stale:    { key: 'reviewed', dir: -1 },
  catalyst: { key: 'catalyst', dir: 1 },
  conviction: { key: 'conviction', dir: -1 },
};
function sortComparator() {
  const { key, dir } = state.sort;
  const get = SORT_KEYS[key] || SORT_KEYS.date;
  return (a, b) => {
    const va = get(a), vb = get(b);
    const na = va == null || va === '', nb = vb == null || vb === '';
    if (na && nb) return a.ticker.localeCompare(b.ticker);
    if (na) return 1;
    if (nb) return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.ticker.localeCompare(b.ticker);
  };
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

/* First number in a value. Handles "$1,234.50", "240.00 (live, Sep 22 2026,
   source)" and plain numbers; anything without a number -> null. */
function num(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
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

/* ---------------- derived metrics (all CALCULATIONS) ---------------- */
/* Newest feed price for a ticker across all of its report rows, so a
   brand-new report inherits the price its older rows already carry. */
function liveFor(ticker) {
  let best = null;
  for (const e of state.entries) {
    if (e.ticker !== ticker || num(e.livePrice) == null) continue;
    if (!best || (e.liveAsOf || '') > (best.liveAsOf || '')) best = e;
  }
  return best ? { price: num(best.livePrice), asOf: best.liveAsOf } : null;
}
function liveOf(e) { const l = liveFor(e.ticker); return l ? l.price : null; }
/* Upside from TODAY's price to the target — the number a decision needs.
   (The old cards only showed upside from the report-day price.) */
function upsideNow(e) { return pct(liveOf(e), num(e.target)); }
function upsideAtReport(e) { return pct(num(e.price), num(e.target)); }
function sinceReport(e) { return pct(num(e.price), liveOf(e)); }

/* Probability-weighted target from the thesis scenarios (only when every
   scenario has a numeric target and the probabilities sum to ~100%). */
function weightedTarget(t) {
  if (!t || !t.scenarios || !t.scenarios.length) return null;
  let sum = 0, w = 0;
  for (const s of t.scenarios) {
    const v = num(s.target);
    if (v == null || s.probability == null) return null;
    sum += v * s.probability; w += s.probability;
  }
  return w > 0.95 && w < 1.05 ? sum / w : null;
}

/* A rating that contradicts the live upside (BUY above target, SELL with
   big upside) means the call is stale — flag it for a decision. */
function callConflict(e) {
  const up = upsideNow(e);
  if (up == null) return null;
  if (e.rating === 'BUY' && up < 0) return `BUY, but live price is ${fmtPct(-up)} above target`;
  if ((e.rating === 'SELL' || e.rating === 'AVOID') && up > 15) return `${e.rating}, but ${fmtPct(up)} to target`;
  return null;
}

/* Parse the dates Claude writes ("2026-10-28", "2026-10", "Oct 28 2026").
   Quarter-style dates ("Q3 2026") are too vague to schedule and return null. */
function parseDay(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);
  if (/\bq[1-4]\b/i.test(str) || !/\d{4}/.test(str)) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function daysUntil(s) {
  const d = parseDay(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
function nextCatalyst(e) {
  let best = null;
  for (const c of (e.thesis && e.thesis.catalysts) || []) {
    const d = daysUntil(c.date);
    if (d == null || d < 0) continue;
    if (!best || d < best.days) best = { ...c, days: d };
  }
  return best;
}
function whenLabel(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 0) return `in ${days}d`;
  return `${-days}d overdue`;
}

/* Small chips summarizing why a card is in the review queue. */
function queueReasonTags(r) {
  const wrap = document.createElement('div');
  wrap.className = 'queue-reason-tags';
  if (r.isNear && r.dTarget != null) {
    wrap.appendChild(reasonChip(`◎ ${r.dTarget.toFixed(0)}% to target`, 'near'));
  }
  if (r.isMover && r.mv != null) {
    const up = r.mv >= 0;
    wrap.appendChild(reasonChip(`${up ? '▲ +' : '▼ '}${r.mv.toFixed(0)}% since report`, up ? 'up' : 'down'));
  }
  if (r.isStale && r.days != null) {
    wrap.appendChild(reasonChip(`◷ ${r.days}d unreviewed`, 'stale'));
  }
  return wrap;
}
function reasonChip(text, cls) {
  const c = document.createElement('span');
  c.className = 'reason-chip reason-' + cls;
  c.textContent = text;
  return c;
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

  /* --- review-queue reason tags: only present on queue tiles. Shows every
     reason the card is in the queue (near target / big move / stale), so the
     one-name-one-section routing never hides a secondary reason. --- */
  if (tile && tile.queueReasons) node.appendChild(queueReasonTags(tile.queueReasons));
  const conflict = callConflict(e);
  if (conflict) {
    const w = document.createElement('div');
    w.className = 'card-warn';
    w.textContent = '⚠ ' + conflict;
    node.appendChild(w);
  }

  /* --- notes --- */
  if (e.notes) {
    const notes = document.createElement('p');
    notes.className = 'card-notes';
    notes.textContent = e.notes;
    node.appendChild(notes);
  }

  /* --- structured-thesis marker: a button that opens this ticker's timeline,
     where the full v2 thesis panel lives. --- */
  if (e.thesis) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'card-thesis-chip';
    const parts = ['📋 View structured thesis'];
    if (e.thesis.call_type) parts.push(e.thesis.call_type);
    if (e.thesis.conviction != null) parts.push(`conviction ${e.thesis.conviction}/5`);
    chip.textContent = parts.join(' · ');
    chip.title = 'Open the full thesis in this ticker’s timeline';
    chip.addEventListener('click', ev => { ev.stopPropagation(); openTimeline(e.ticker); });
    node.appendChild(chip);
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
        badgePct.title = 'CALC: upside from the report-day price to target';
        row.appendChild(badgePct);
      }
    }
    node.appendChild(row);
  }

  /* --- live row (only once fetched) --- */
  const live = liveOf(e);
  if (live != null) {
    const row = document.createElement('div');
    row.className = 'live-row';
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    const label = document.createElement('span');
    label.textContent = `Live ${fmtMoney(live)}`;
    row.append(dot, label);

    const since = sinceReport(e);
    if (since != null) {
      const s = document.createElement('span');
      s.className = 'live-since ' + (since >= 0 ? 'up' : 'down');
      s.textContent = `${fmtPct(since)} since report`;
      row.appendChild(s);
    }
    const up = upsideNow(e);
    if (up != null) {
      const u = document.createElement('span');
      u.className = 'live-since ' + (up >= 0 ? 'up' : 'down');
      u.textContent = `${fmtPct(up)} to target`;
      u.title = 'CALC: live price → target';
      row.appendChild(u);
    }
    node.appendChild(row);
  } else if (!isMacro && state.priceRefreshDone) {
    /* refresh has run but this ticker got no quote — surface it instead of a blank */
    const row = document.createElement('div');
    row.className = 'live-row live-missing';
    const dot = document.createElement('span');
    dot.className = 'live-dot missing';
    const label = document.createElement('span');
    label.textContent = 'No live quote';
    label.title = 'The price feed has no quote for this ticker yet — it is picked up on the next price update.';
    row.append(dot, label);
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
  markBtn.addEventListener('click', ev => { ev.stopPropagation(); markReviewed(e.id, node, markBtn); });

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

  const actions = document.createElement('div');
  actions.className = 'tl-actions';

  const promptBtn = document.createElement('button');
  promptBtn.type = 'button';
  promptBtn.className = 'btn btn-outline';
  promptBtn.textContent = '⧉ Research prompt';
  promptBtn.title = 'Copy a ready-to-paste Claude prompt for this company (includes your latest thesis)';
  promptBtn.addEventListener('click', () => openPromptModal({
    ticker, company: rep.company, sector: rep.sector, type: rep.thesis ? 'earnings' : 'deep' }));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-gold tl-add';
  addBtn.textContent = '+ New report';
  addBtn.addEventListener('click', () =>
    openEntryModal(null, { ticker, company: rep.company, sector: rep.sector, status: rep.status }));

  actions.append(promptBtn, addBtn);
  head.append(back, idwrap, actions);
  view.appendChild(head);
  if (entries[0]) view.appendChild(companyStats(rep));

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

/* Key-numbers strip at the top of a company page. Every % is a CALC
   from stored prices; the weighted target is a CALC from scenarios. */
function companyStats(e) {
  const box = document.createElement('div');
  box.className = 'co-stats';
  const live = liveFor(e.ticker);
  const stat = (label, value, cls, title) => {
    const d = document.createElement('div');
    d.className = 'co-stat';
    if (title) d.title = title;
    const v = document.createElement('div');
    v.className = 'co-stat-v' + (cls ? ' ' + cls : '');
    v.textContent = value;
    const l = document.createElement('div');
    l.className = 'co-stat-l';
    l.textContent = label;
    d.append(v, l);
    box.appendChild(d);
  };
  const signCls = p => p == null ? 'dim' : p >= 0 ? 'pos' : 'neg';

  stat('Live', live ? fmtMoney(live.price) : '—', live ? '' : 'dim',
    live && live.asOf ? 'Feed price as of ' + new Date(live.asOf).toLocaleString() : 'No feed price yet');
  stat('Target', fmtMoney(e.target));
  const up = upsideNow(e);
  stat('To target', up == null ? '—' : fmtPct(up), signCls(up), 'CALC: live price → target');
  const sr = sinceReport(e);
  stat(`Since ${e.date || 'report'}`, sr == null ? '—' : fmtPct(sr), signCls(sr), 'CALC: report-day price → live');
  const wt = weightedTarget(e.thesis);
  if (wt != null) stat('Scenario-weighted', fmtMoney(wt), '', 'CALC: Σ probability × scenario target');
  if (e.thesis && e.thesis.conviction) stat('Conviction', `${e.thesis.conviction}/5`);
  const rd = daysSinceReviewed(e);
  stat('Reviewed', rd == null ? 'never' : rd <= 0 ? 'today' : `${rd}d ago`, staleBand(rd));

  // status + review controls (act on the current report)
  const ctl = document.createElement('div');
  ctl.className = 'co-ctl';
  const sel = document.createElement('select');
  sel.className = 'co-status';
  sel.title = 'Position status';
  for (const s of ['Watching', 'Holding', 'Passed', 'Unset']) {
    const o = document.createElement('option');
    o.value = s; o.textContent = s === 'Unset' ? 'No status' : s;
    sel.appendChild(o);
  }
  sel.value = e.status || 'Unset';
  sel.addEventListener('change', () => guarded(async () => {
    await dataStore.setStatus(e.id, sel.value);
    state.entries = await dataStore.getAll();
    render();
    toast(`${e.ticker} status: ${sel.value}.`, 'ok');
  }, 'Could not update status'));
  const rev = document.createElement('button');
  rev.type = 'button';
  rev.className = 'mark-reviewed';
  rev.textContent = '✓ Mark reviewed';
  rev.addEventListener('click', () => markReviewed(e.id, null, rev));
  ctl.append(sel, rev);
  box.appendChild(ctl);

  const conflict = callConflict(e);
  if (conflict) {
    const w = document.createElement('div');
    w.className = 'co-warn';
    w.textContent = `⚠ ${conflict} — re-underwrite the call or update the target.`;
    box.appendChild(w);
  }
  return box;
}

/* ============================================================
   Structured thesis panel — collapsible, read-only.
   ============================================================ */
const ASSUMPTION_LABEL = { intact: 'Intact', watch: 'Watch', broken: 'Broken' };

function thesisPanel(t, startOpen) {
  const box = document.createElement('details');
  box.className = 'tl-thesis';
  // Expanded by default on the current report so the thesis is visible without
  // an extra click (older reports collapse to keep the timeline tidy).
  if (startOpen) box.open = true;
  // Don't let clicks inside the panel bubble up to the row's "edit" handler.
  box.addEventListener('click', ev => ev.stopPropagation());

  const sum = document.createElement('summary');
  sum.className = 'th-summary';
  const tag = document.createElement('span');
  tag.className = 'th-tag';
  const STAGE = { screen: 'Screen', deep_dive: 'Deep dive', update: 'Update' };
  tag.textContent = '📋 Thesis' + (t.research_stage ? ' · ' + STAGE[t.research_stage] : '');
  sum.appendChild(tag);
  if (t.call_type) {
    const ct = document.createElement('span');
    ct.className = 'th-calltype th-' + t.call_type.toLowerCase();
    ct.textContent = t.call_type;
    sum.appendChild(ct);
  }
  if (t.conviction != null) {
    const conv = document.createElement('span');
    conv.className = 'th-conviction';
    conv.title = `Conviction ${t.conviction}/5`;
    conv.textContent = '●'.repeat(t.conviction) + '○'.repeat(5 - t.conviction);
    sum.appendChild(conv);
  }
  box.appendChild(sum);

  const body = document.createElement('div');
  body.className = 'th-body';

  if (t.one_liner) {
    const ol = document.createElement('p');
    ol.className = 'th-oneliner';
    ol.textContent = t.one_liner;
    body.appendChild(ol);
  }

  if (t.variant_view) body.appendChild(thCallout('Variant view — what the market is missing', t.variant_view, 'th-variant'));
  if (t.market_implies) body.appendChild(thCallout('What the price implies', t.market_implies, 'th-implies'));

  if (t.key_drivers && t.key_drivers.length) {
    body.appendChild(thSectionTitle('Key drivers'));
    const tbl = document.createElement('div');
    tbl.className = 'th-drivers';
    for (const d of t.key_drivers) {
      const r = document.createElement('div');
      r.className = 'th-driver';
      const n = document.createElement('span'); n.className = 'th-driver-n'; n.textContent = d.driver;
      const c = document.createElement('span'); c.className = 'th-driver-c'; c.textContent = d.current || '—';
      const x = document.createElement('span'); x.className = 'th-driver-x'; x.textContent = d.sensitivity || '';
      r.append(n, c, x);
      tbl.appendChild(r);
    }
    body.appendChild(tbl);
  }

  if (t.scenarios && t.scenarios.length) {
    body.appendChild(thSectionTitle('Scenarios'));
    const sc = document.createElement('div');
    sc.className = 'th-scenarios';
    for (const x of t.scenarios) {
      const c = document.createElement('div');
      c.className = 'th-scn th-scn-' + x.case;
      const top = document.createElement('div');
      top.className = 'th-scn-top';
      top.textContent = `${x.case.toUpperCase()} · ${x.target ? fmtMoney(x.target) : '—'}`
        + (x.probability != null ? ` · ${Math.round(x.probability * 100)}%` : '');
      const n = document.createElement('div');
      n.className = 'th-sub';
      n.textContent = x.narrative;
      c.append(top, n);
      sc.appendChild(c);
    }
    body.appendChild(sc);
    const wt = weightedTarget(t);
    if (wt != null) {
      const w = document.createElement('div');
      w.className = 'th-calc';
      w.textContent = `Probability-weighted target (CALC): ${fmtMoney(wt)}`;
      body.appendChild(w);
    }
  }

  if (t.prediction && t.prediction.statement) {
    const pred = document.createElement('div');
    pred.className = 'th-prediction';
    const label = document.createElement('div');
    label.className = 'th-pred-label';
    label.textContent = t.prediction.by
      ? `Gradeable prediction · by ${t.prediction.by}`
      : 'Gradeable prediction';
    const stmt = document.createElement('div');
    stmt.className = 'th-pred-stmt';
    stmt.textContent = t.prediction.statement;
    pred.append(label, stmt);
    body.appendChild(pred);
  }

  if (t.assumptions && t.assumptions.length) {
    body.appendChild(thSectionTitle('Assumptions'));
    const ul = document.createElement('ul');
    ul.className = 'th-assumptions';
    for (const a of t.assumptions) {
      const li = document.createElement('li');
      li.className = 'th-assumption';
      const head = document.createElement('div');
      head.className = 'th-assump-head';
      const st = document.createElement('span');
      st.className = 'th-status th-status-' + a.status;
      st.textContent = ASSUMPTION_LABEL[a.status] || a.status;
      const claim = document.createElement('span');
      claim.className = 'th-claim';
      claim.textContent = a.claim;
      head.append(st, claim);
      li.appendChild(head);
      const meta = [];
      if (a.confirm_if) meta.push(['Confirm if', a.confirm_if]);
      if (a.break_if) meta.push(['Break if', a.break_if]);
      for (const [k, v] of meta) {
        const d = document.createElement('div');
        d.className = 'th-assump-meta';
        const b = document.createElement('strong');
        b.textContent = k + ': ';
        d.append(b, document.createTextNode(v));
        li.appendChild(d);
      }
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  if (t.catalysts && t.catalysts.length) {
    body.appendChild(thSectionTitle('Catalysts'));
    const ul = document.createElement('ul');
    ul.className = 'th-list th-catalysts';
    for (const c of t.catalysts) {
      const li = document.createElement('li');
      const ev = document.createElement('strong');
      ev.textContent = c.event;
      li.appendChild(ev);
      if (c.date) li.append(document.createTextNode(` · ${c.date}`));
      if (c.matters_because) {
        const why = document.createElement('div');
        why.className = 'th-sub';
        why.textContent = c.matters_because;
        li.appendChild(why);
      }
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  if (t.watch_next_quarter && t.watch_next_quarter.length) {
    body.appendChild(thSectionTitle('Watch next quarter'));
    body.appendChild(thBulletList(t.watch_next_quarter, 'th-watch'));
  }

  if (t.thesis_breakers && t.thesis_breakers.length) {
    body.appendChild(thSectionTitle('Thesis breakers'));
    body.appendChild(thBulletList(t.thesis_breakers, 'th-breakers'));
  }

  if (t.risks && t.risks.length) {
    body.appendChild(thSectionTitle('Risks the bull case ignores'));
    body.appendChild(thBulletList(t.risks, 'th-breakers'));
  }

  if (t.data_gaps && t.data_gaps.length) {
    body.appendChild(thSectionTitle('Data gaps (unverified)'));
    body.appendChild(thBulletList(t.data_gaps, 'th-gaps'));
  }

  if (t.next_review) {
    const nr = document.createElement('div');
    nr.className = 'th-calc';
    const d = daysUntil(t.next_review);
    nr.textContent = `Next scheduled review: ${t.next_review}` + (d != null ? ` (${whenLabel(d)})` : '');
    body.appendChild(nr);
  }

  if (t.changes_since_last && t.changes_since_last.length) {
    body.appendChild(thSectionTitle('Changes since last'));
    body.appendChild(thBulletList(t.changes_since_last, 'th-changes'));
  }

  box.appendChild(body);
  return box;
}

function thCallout(title, text, cls) {
  const d = document.createElement('div');
  d.className = 'th-callout ' + (cls || '');
  const h = document.createElement('div');
  h.className = 'th-callout-h';
  h.textContent = title;
  const p = document.createElement('div');
  p.textContent = text;
  d.append(h, p);
  return d;
}

function thSectionTitle(text) {
  const h = document.createElement('div');
  h.className = 'th-section';
  h.textContent = text;
  return h;
}

function thBulletList(items, cls) {
  const ul = document.createElement('ul');
  ul.className = 'th-list ' + (cls || '');
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = it;
    ul.appendChild(li);
  }
  return ul;
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

  if (e.thesis) row.appendChild(thesisPanel(e.thesis, isCurrent));

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
  $('#f_status').value = seed.status || 'Unset';
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

  if (entry.id) {
    const existing = state.entries.find(e => e.id === entry.id);
    if (existing) {
      entry.lastReviewed = existing.lastReviewed;
      // The structured thesis isn't editable in this modal — carry it
      // through so a flat edit (e.g. fixing notes) never discards it.
      if (existing.thesis) entry.thesis = existing.thesis;
    }
  } else {
    entry.lastReviewed = todayISO();   // writing a new report IS a review
  }

  await guarded(async () => {
    await dataStore.upsert(entry);
    state.entries = await dataStore.getAll();
    closeModal(entryModal);
    render();
    toast(entry.id ? 'Research updated.' : 'Research added.', 'ok');
  }, 'Could not save');
}

/* Run a save; on failure show the real error instead of failing silently. */
async function guarded(fn, what) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(`${what}: ${err.message || err}`, 'err');
  }
}

/* Bump an entry back to "fresh" — stamp lastReviewed = today, then re-render
   the ACTIVE view (queue, grid or timeline) so the tile visibly updates. In the
   queue, the card fades out first since it's about to leave the list. */
async function markReviewed(id, cardNode, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const inQueue = state.activeSector === QUEUE && !state.timelineTicker;
  try {
    await dataStore.markReviewed(id, todayISO());
    state.entries = await dataStore.getAll();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Mark reviewed'; }
    toast('Could not mark reviewed: ' + (err.message || err), 'err');
    return;
  }
  if (inQueue && cardNode) {
    cardNode.classList.add('card-leaving');
    await new Promise(r => setTimeout(r, 250));
  }
  render();
  toast(inQueue ? 'Marked reviewed — removed from the queue.' : 'Marked reviewed today.', 'ok');
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

  let moved = 0;
  try {
    moved = await dataStore.renameSector(renameOldName, newName);
    state.entries = await dataStore.getAll();
  } catch (err) {
    toast('Could not rename: ' + (err.message || err), 'err');
    return;
  }
  // keep the sidebar selection pointing at the renamed sector if it was active
  if (state.activeSector === renameOldName) state.activeSector = newName;
  closeModal(renameModal);
  render();
  toast(`Renamed to “${newName}” — updated ${moved} ${moved === 1 ? 'entry' : 'entries'}.`, 'ok');
}

async function deleteEntry() {
  const id = $('#f_id').value;
  if (!id) return;
  const e = state.entries.find(x => x.id === id);
  if (!confirm(`Delete this ${e ? e.ticker + ' ' : ''}report${e && e.date ? ' (' + e.date + ')' : ''}? This can't be undone.`)) return;
  await guarded(async () => {
    await dataStore.remove(id);
    state.entries = await dataStore.getAll();
    closeModal(entryModal);
    render();
    toast('Research deleted.', 'ok');
  }, 'Could not delete');
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


  // Make imports idempotent and continuous:
  //  • same ticker + same report date as an existing report → update it
  //    (re-pasting a JSON never creates duplicates)
  //  • no date → today; importing a report counts as reviewing it today
  //  • no status → carry the ticker's current status forward
  let updated = 0;
  const followUps = new Set();   // new reports added to an existing ticker's timeline
  for (const o of valid) {
    const t = String(o.ticker).trim().toUpperCase();
    if (!o.date) o.date = todayISO();
    const priors = state.entries.filter(e => e.ticker === t).sort(sortEntries);
    const same = t !== 'MACRO' && priors.find(e => e.date === o.date);
    if (!o.id && same) { o.id = same.id; updated++; }
    else if (t !== 'MACRO' && priors.length) followUps.add(t);
    if (!o.status && priors[0]) o.status = priors[0].status;
    o.lastReviewed = todayISO();
  }

  try {
    await dataStore.bulkUpsert(valid);
    state.entries = await dataStore.getAll();
  } catch (err) {
    errBox.textContent = 'Could not save: ' + (err.message || err);
    errBox.hidden = false;
    return;
  }
  closeModal(importModal);
  render();
  const added = valid.length - updated;
  toast(`Imported ${added} new${updated ? `, updated ${updated} existing` : ''}.`, 'ok');
  if (followUps.size) {
    const list = [...followUps];
    const names = list.slice(0, 4).join(', ') + (list.length > 4 ? '…' : '');
    toast(`Added to existing timelines: ${names}. Click a ticker symbol to see history.`, '');
  }
}

/* ============================================================
   Research prompt modal — builds a ready-to-paste Claude prompt
   for any ticker and stage. Earnings / thesis-check prompts embed
   the latest stored thesis automatically (no hunting for last
   quarter's JSON).
   ============================================================ */
const promptModal = $('#promptModal');

function openPromptModal(opts = {}) {
  const sel = $('#p_type');
  if (!sel.options.length) {
    for (const t of PROMPT_TYPES) {
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.label;
      sel.appendChild(o);
    }
  }
  $('#p_ticker').value = opts.ticker || '';
  $('#p_company').value = opts.company || '';
  $('#p_company').dataset.sector = opts.sector || '';
  sel.value = opts.type || 'screen';
  updatePromptPreview();
  openModal(promptModal);
  (opts.ticker ? sel : $('#p_ticker')).focus();
}

function updatePromptPreview() {
  const ticker = $('#p_ticker').value.trim().toUpperCase();
  const prior = ticker ? reportsForTicker(ticker)[0] || null : null;
  const company = $('#p_company').value.trim() || (prior && prior.company) || '';
  const sector = $('#p_company').dataset.sector || (prior && prior.sector) || '';
  const type = $('#p_type').value;
  const needsPrior = (PROMPT_TYPES.find(t => t.id === type) || {}).needsPrior;
  const note = $('#p_note');
  if (needsPrior && !prior) {
    note.textContent = `No stored report for ${ticker || 'this ticker'} — the prompt will run without a prior thesis.`;
  } else if (needsPrior) {
    note.textContent = `Includes your ${prior.date || 'latest'} report${prior.thesis ? ' and structured thesis' : ''} as the prior thesis.`;
  } else {
    note.textContent = 'Paste this into Claude with your source documents; import the JSON it returns via “Paste from Claude”.';
  }
  $('#p_text').value = buildPrompt(type, { ticker, company, sector, prior: needsPrior ? prior : null });
}

async function copyPrompt() {
  const text = $('#p_text').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('Prompt copied — paste it into Claude.', 'ok');
  } catch {
    $('#p_text').select();
    toast('Select-all done — press ⌘C to copy.', '');
  }
}

/* ============================================================
   Settings modal + live price refresh
   ============================================================ */
const settingsModal = $('#settingsModal');

async function openSettingsModal() {
  $('#accountEmail').textContent = state.userEmail ? `Signed in as ${state.userEmail}` : '';
  openModal(settingsModal);
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

/* Prices are written to the database by the price feed
   (scripts/update_prices.py, Yahoo Finance). The browser can't fetch quotes
   itself (CORS), so this button reloads whatever the feed last wrote. */
async function doRefresh() {
  const btn = $('#refreshBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-ico spin">⟳</span> Loading…';

  state.entries = await dataStore.getAll();
  state.priceRefreshDone = true;
  render();
  showLastRefresh();

  btn.disabled = false;
  btn.innerHTML = original;

  const missing = [...new Set(state.entries
    .filter(e => e.ticker !== 'MACRO' && !liveFor(e.ticker)).map(e => e.ticker))];
  if (missing.length) {
    const list = missing.slice(0, 6).join(', ') + (missing.length > 6 ? '…' : '');
    toast(`Loaded latest prices. Not priced yet for ${missing.length}: ${list}. Newly added tickers get a price on the next feed update (or ask Claude to update now).`, 'err', true);
  } else {
    toast('Loaded latest prices from your feed.', 'ok');
  }
}

/* "Prices as of" = the newest liveAsOf stamp across entries (set by the feed). */
function showLastRefresh() {
  const stamps = state.entries.map(e => e.liveAsOf).filter(Boolean).sort();
  const iso = stamps[stamps.length - 1];
  if (!iso) { el.lastRefresh.textContent = 'Prices not yet updated'; return; }
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
function toast(msg, kind = '', sticky = false) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  t.title = 'Click to dismiss';
  const remove = () => { t.classList.add('fade'); setTimeout(() => t.remove(), 300); };
  t.addEventListener('click', remove);          // always click-to-dismiss
  el.toastWrap.appendChild(t);
  if (!sticky) {
    // errors linger much longer so they can actually be read
    setTimeout(remove, kind === 'err' ? 11000 : 3600);
  }
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
  $('#exportDataBtn').addEventListener('click', exportData);
  $('#signOutBtn').addEventListener('click', signOut);

  $('#renameSaveBtn').addEventListener('click', saveRename);
  $('#f_renameSector').addEventListener('input', updateRenameHint);
  $('#f_renameSector').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } });

  $('#promptBtn').addEventListener('click', () => openPromptModal());
  $('#p_type').addEventListener('change', updatePromptPreview);
  $('#p_ticker').addEventListener('input', updatePromptPreview);
  $('#p_company').addEventListener('input', updatePromptPreview);
  $('#p_copy').addEventListener('click', copyPrompt);

  el.searchInput.addEventListener('input', e => { state.search = e.target.value; renderCards(); });
  $('#sortSelect').addEventListener('change', e => {
    const p = SORT_PRESETS[e.target.value];
    if (p) { state.sort = { ...p }; saveViewPrefs(); renderCards(); }
  });
  $('#statusFilter').addEventListener('change', e => { state.statusFilter = e.target.value || null; renderCards(); });
  document.querySelectorAll('#viewToggle button').forEach(b =>
    b.addEventListener('click', () => { state.view = b.dataset.view; saveViewPrefs(); renderCards(); }));

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
  [entryModal, importModal, settingsModal, renameModal, promptModal].forEach(closeModal);
}
