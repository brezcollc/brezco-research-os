/* ============================================================
   app.js — UI controller for Brezco Research OS.
   Talks to the data layer only through `dataStore` (dataStore.js)
   so the storage backend can be swapped in Phase 2 without
   touching any of this rendering / event code.
   ============================================================ */

import { dataStore } from './dataStore.js';
import { refreshPrices } from './prices.js';

/* ---------------- in-memory view state ---------------- */
const state = {
  entries: [],
  activeSector: '__ALL__',
  search: '',
  sort: 'recent',      // 'recent' | 'upside' | 'downside' | 'stale'
  ratingFilter: null,  // null (all) | 'BUY' | 'HOLD' | 'SELL' | 'AVOID' | 'N/A'
  statusFilter: null,  // null (all) | 'Holding' | 'Watching' | 'Passed' | 'Unset'
};

const ALL = '__ALL__';

/* ---------------- element handles ---------------- */
const $ = sel => document.querySelector(sel);
const el = {
  statReports: $('#statReports'),
  statSectors: $('#statSectors'),
  statTickers: $('#statTickers'),
  sectorNav: $('#sectorNav'),
  cardGrid: $('#cardGrid'),
  emptyState: $('#emptyState'),
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
  await populateSectorSelect();
  render();
  showLastRefresh();
})();

/* ============================================================
   Rendering
   ============================================================ */
function sectorsWithCounts() {
  const map = new Map();
  for (const e of state.entries) {
    const s = e.sector || 'Uncategorized';
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
  renderCards();
}

function renderStats() {
  el.statReports.textContent = state.entries.length;
  el.statSectors.textContent = sectorsWithCounts().length;
  el.statTickers.textContent = uniqueTickerCount();
}

function renderSectorNav() {
  const sectors = sectorsWithCounts();
  const frag = document.createDocumentFragment();

  frag.appendChild(sectorButton(ALL, 'All Research', state.entries.length, true));

  const div = document.createElement('div');
  div.className = 'sector-divider';
  frag.appendChild(div);

  for (const [name, count] of sectors) {
    frag.appendChild(sectorButton(name, name, count, false));
  }
  el.sectorNav.replaceChildren(frag);
}

function sectorButton(key, label, count, isAll) {
  const btn = document.createElement('div');
  btn.className = 'sector-item' + (isAll ? ' all' : '') + (state.activeSector === key ? ' active' : '');
  btn.setAttribute('role', 'button');
  btn.tabIndex = 0;

  const name = document.createElement('span');
  name.className = 'sector-name';
  name.textContent = label;

  const badge = document.createElement('span');
  badge.className = 'sector-count';
  badge.textContent = count;

  btn.append(name, badge);
  const activate = () => { state.activeSector = key; render(); };
  btn.addEventListener('click', activate);
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  return btn;
}

function visibleEntries() {
  const q = state.search.trim().toLowerCase();
  return state.entries.filter(e => {
    if (state.activeSector !== ALL && e.sector !== state.activeSector) return false;
    if (state.ratingFilter && e.rating !== state.ratingFilter) return false;
    if (state.statusFilter && (e.status || 'Unset') !== state.statusFilter) return false;
    if (!q) return true;
    return (e.ticker + ' ' + e.company + ' ' + e.notes + ' ' + e.sector).toLowerCase().includes(q);
  });
}

function renderCards() {
  el.sectionTitle.textContent = state.activeSector === ALL ? 'All Research' : state.activeSector;

  const entries = visibleEntries().sort(sortComparator());
  el.cardGrid.replaceChildren();

  if (entries.length === 0) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  const frag = document.createDocumentFragment();
  for (const e of entries) frag.appendChild(card(e));
  el.cardGrid.appendChild(frag);
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

function card(e) {
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
  const co = document.createElement('div');
  co.className = 'card-company';
  co.textContent = e.company || '—';
  co.title = e.company || '';
  ident.append(tk, co);

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
   Add / Edit modal
   ============================================================ */
const entryModal = $('#entryModal');
const entryForm = $('#entryForm');

async function populateSectorSelect(selected) {
  const sel = $('#f_sectorSelect');
  const sectors = sectorsWithCounts().map(s => s[0]);
  sel.replaceChildren();
  for (const s of sectors) {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  }
  const nw = document.createElement('option');
  nw.value = '__NEW__'; nw.textContent = '+ New sector…';
  sel.appendChild(nw);
  if (selected != null) sel.value = selected;
}

function openEntryModal(entry) {
  const editing = !!entry;
  $('#entryModalTitle').textContent = editing ? 'Edit Research' : 'Add Research';
  $('#deleteBtn').hidden = !editing;

  $('#f_id').value = editing ? entry.id : '';
  $('#f_ticker').value = editing ? entry.ticker : '';
  $('#f_company').value = editing ? entry.company : '';
  $('#f_rating').value = editing ? entry.rating : 'N/A';
  $('#f_status').value = editing ? (entry.status || 'Unset') : 'Unset';
  $('#f_price').value = editing ? entry.price : '';
  $('#f_target').value = editing ? entry.target : '';
  $('#f_link').value = editing ? entry.link : '';
  $('#f_date').value = editing ? entry.date : '';
  $('#f_notes').value = editing ? entry.notes : '';

  populateSectorSelect(editing ? entry.sector : (sectorsWithCounts()[0]?.[0] || '__NEW__'));
  syncNewSectorField();
  openModal(entryModal);
  $('#f_ticker').focus();
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

  await dataStore.bulkUpsert(valid);
  state.entries = await dataStore.getAll();
  closeModal(importModal);
  render();
  toast(`Imported ${valid.length} ${valid.length === 1 ? 'entry' : 'entries'}.`, 'ok');
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

  $('#importSubmit').addEventListener('click', submitImport);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#exportDataBtn').addEventListener('click', exportData);

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
  [entryModal, importModal, settingsModal].forEach(closeModal);
}
