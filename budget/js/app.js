/* app.js — boot, routing and every user action. */
import { store, Store } from './store.js';
import { ui, today } from './ctx.js';
import { icon, esc, closeSheet, closeAllSheets, toast, confirmSheet, saveFile } from './ui.js';
import { addMonths, monthKey } from './dates.js';
import { computeMonth, sweepAmount, categoryIndex } from './engine.js';
import { recordTransfer } from './savings.js';
import { fmt } from './money.js';
import * as V from './views.js';
import * as F from './forms.js';
import { defaultCategoryRows, buildDemo } from './demo.js';
import { transactionsCSV, summaryCSV, backupJSON, parseBackup, importTransactions } from './csv.js';

const app = document.getElementById('app');
const TABS = [
  ['dashboard', 'Home', 'home'], ['transactions', 'Activity', 'list'], ['budget', 'Budget', 'target'],
  ['analytics', 'Analytics', 'chart'], ['settings', 'Settings', 'gear'],
];

/* ---------------- render ---------------- */
let mounted = false;
function render() {
  if (!store.mode) return renderWelcome();
  if (!mounted) {
    app.innerHTML = `<main class="screen" id="screen"></main>
      <button class="fab" data-act="addTx" aria-label="Add transaction">${icon('plus')}</button>
      <nav class="nav"><div class="nav-in">${TABS.map(([k, l, i]) => `<button data-act="tab" data-tab="${k}" aria-label="${l}">${icon(i)}<span>${l}</span></button>`).join('')}</div></nav>`;
    mounted = true;
  }
  const screen = document.getElementById('screen');
  const active = document.activeElement;
  const keepSearch = active && active.dataset && active.dataset.input === 'txSearch' ? { pos: active.selectionStart } : null;
  let html;
  try {
    if (ui.page?.type === 'category') html = V.categoryPage(ui.page.id, ui.page.month);
    else html = (V[ui.tab] || V.dashboard)();
  } catch (e) {
    console.error(e);
    html = `<div class="card"><h3>Something went wrong</h3><p class="muted">${esc(e.message)}</p></div>`;
  }
  screen.innerHTML = html;
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  if (keepSearch) {
    const el = screen.querySelector('[data-input="txSearch"]');
    if (el) { el.focus(); try { el.setSelectionRange(keepSearch.pos, keepSearch.pos); } catch { /* ignore */ } }
  }
}

function renderWelcome() {
  mounted = false;
  const hasLocal = Store.hasLocalData();
  app.innerHTML = `<div class="welcome">
    <div class="brand"><img class="logo" src="icons/icon.svg" alt=""><span class="name">Runway</span></div>
    <h1>Your personal CFO, in your pocket.</h1>
    <p class="lead">Know exactly what you can safely spend today — after bills, savings and the timing of your paychecks.</p>
    <div class="stack">
      <button class="btn primary block" data-act="signInSheet" data-mode="signup">Create an account</button>
      <button class="btn block" data-act="signInSheet" data-mode="signin">Sign in</button>
      <div class="divider">or</div>
      <button class="btn block ghost" data-act="startLocal">${hasLocal ? 'Continue on this device' : 'Use on this device only'}</button>
      ${hasLocal ? '' : `<button class="btn block ghost" data-act="startDemo" style="color:var(--green)">Explore with sample data</button>`}
    </div>
    <p class="fine">Accounts sync across devices and are private to you. Device-only mode keeps everything on this phone — you can sign in later and your data comes with you.</p>
  </div>`;
}

store.subscribe(reason => {
  if (reason === 'signout') { ui.tab = 'dashboard'; ui.page = null; closeAllSheets(); }
  if (reason === 'sync' && store.sync.status === 'synced') {
    if (store.sync.migratedFromDevice) { store.sync.migratedFromDevice = false; toast('Your device data was copied to your account'); }
    ensureDefaults(); // no-op unless this account has no categories yet
  }
  render();
});

/* ---------------- navigation ---------------- */
function go(tab) {
  ui.tab = tab; ui.page = null; ui.pageStack = []; ui.chartSel = {};
  render(); window.scrollTo(0, 0);
}
function openPage(page) {
  ui.pageStack.push({ page: ui.page, scroll: window.scrollY });
  ui.page = page; ui.chartSel = {};
  render(); window.scrollTo(0, 0);
}
function back() {
  const prev = ui.pageStack.pop();
  ui.page = prev ? prev.page : null;
  render();
  window.scrollTo(0, prev ? prev.scroll : 0);
}

/* ---------------- defaults ---------------- */
function ensureDefaults() {
  const st = store.state;
  if (store.mode === 'cloud' && store.sync.status !== 'synced') return;
  if (st.categories.length === 0 && !st.settings.prefs?.initialized) {
    store.batch(tx => {
      for (const c of defaultCategoryRows()) tx.upsert('categories', c);
      tx.settings({ prefs: { ...(st.settings.prefs || {}), initialized: true } });
    });
  }
}

function loadDemo() {
  const st = store.state;
  if (!st.categories.length) for (const c of defaultCategoryRows()) store.upsert('categories', c, { silent: true });
  const d = buildDemo(store.state.categories, today());
  store.batch(tx => {
    for (const c of d.categories) tx.upsert('categories', c);
    for (const [coll, rows] of Object.entries(d.rows)) for (const r of rows) tx.upsert(coll, r);
    const s = store.state.settings;
    const prefs = { ...(s.prefs || {}), initialized: true,
      billSources: { ...(s.prefs?.billSources || {}), ...d.settings.prefs.billSources },
      billGoals: { ...(s.prefs?.billGoals || {}), ...d.settings.prefs.billGoals } };
    if (!s.prefs?.savingsTargetPct) { prefs.savingsTargetPct = d.settings.prefs.savingsTargetPct; prefs.demoTarget = true; }
    if (s.balanceCents === null || s.balanceCents === undefined || s.demoBalance) tx.settings({ ...d.settings, prefs });
    else tx.settings({ prefs });
  });
  toast('Sample data loaded — remove it any time in Settings');
}

async function startCloudSession(session) {
  closeAllSheets();
  await store.startCloud(session);
  ensureDefaults();
  if (store.sync.setupRequired) toast('Cloud tables missing — see Settings', { ms: 5000 });
  else toast(`Signed in as ${session.user.email}`);
}

/* ---------------- actions ---------------- */
const isTransfer = billId => {
  const b = store.state.bills.find(x => x.id === billId);
  return !!b && categoryIndex(store.state).kindOf(b.categoryId) === 'savings';
};
const A = {
  noop() {},
  tab: d => go(d.tab),
  closeSheet: () => closeSheet(),
  back,
  seg: d => { ui.seg = d.seg; render(); },
  openSeg: d => { ui.seg = d.seg; if (d.seg === 'income' || d.seg === 'bills' || d.seg === 'spending') ui.month = monthKey(today()); go('budget'); },
  month: d => { ui.month = addMonths(ui.month, Number(d.d)); ui.chartSel = {}; render(); },
  txMonth: d => { ui.tx.month = addMonths(ui.tx.month, Number(d.d)); render(); },
  calMonth: d => { ui.calMonth = addMonths(ui.calMonth, Number(d.d)); ui.calSel = null; render(); },
  catMonth: d => { ui.page.month = addMonths(ui.page.month, Number(d.d)); ui.chartSel = {}; render(); },
  calSel: d => { ui.calSel = ui.calSel === d.date ? null : d.date; render(); },
  txKind: d => { ui.tx.kind = d.k; render(); },
  txMore: () => { ui.txLimit += 250; render(); },
  anKind: d => { ui.anKind = d.k; render(); },
  chartSel: d => { const i = Number(d.i); ui.chartSel[d.chart] = ui.chartSel[d.chart] === i ? null : i; render(); },
  toggleInsights: () => { ui.showAllInsights = !ui.showAllInsights; render(); },
  dismissSetup: () => { ui.dismissSetup = true; render(); },
  openCategory: d => { if (!d.id) return; openPage({ type: 'category', id: d.id, month: d.month || (ui.tab === 'budget' || ui.tab === 'analytics' ? ui.month : monthKey(today())) }); },

  addTx: d => F.openTxForm({ kind: d.kind, cat: d.cat }),
  editTx: d => F.openTxForm({ id: d.id }),
  newIncome: () => F.openIncomeForm(),
  editIncome: d => F.openIncomeForm(d.id),
  receiveIncome: d => F.openReceiveIncome(d.source, d.date),
  newBill: () => F.openBillForm(),
  editBill: d => (isTransfer(d.id) ? F.openTransferForm(d.id) : F.openBillForm(d.id)),
  newTransfer: () => F.openTransferForm(),
  editTransfer: d => F.openTransferForm(d.id),
  editTarget: () => F.openTargetForm(),
  moveMoney: () => F.openMoveSheet(),
  sweep: () => {
    const m = computeMonth(store.state, monthKey(today()), today());
    F.openMoveSheet({ amountCents: sweepAmount(m) || null, merchant: 'Month-end sweep', title: 'Sweep leftover to savings' });
  },
  moveTransfer: d => {
    const saved = recordTransfer(store.state, d.bill, d.date, today());
    if (saved) toast(`Moved ${fmt(saved.amountCents)} · ${saved.merchant}`, { action: 'Undo', onAction: () => store.remove('transactions', saved.id) });
  },
  payBill: d => F.openPayBill(d.bill, d.date),
  newCategory: d => F.openCategoryForm(null, { parentId: d.parent || null }),
  editCategory: d => F.openCategoryForm(d.id),
  editBudget: d => F.openBudgetForm(d.id, d.month),
  newGoal: () => F.openGoalForm(),
  editGoal: d => F.openGoalForm(d.id),
  contribute: d => F.openContribute(d.id),
  goalHistory: d => F.openGoalHistory(d.id, V.txRow),
  editBalance: () => F.openBalanceForm(computeMonth(store.state, monthKey(today()), today()).cash?.balanceNow ?? null),
  editBuffer: () => F.openBufferForm(),
  changePassword: () => F.openPasswordForm(),

  signInSheet: d => F.openAuthForm({ mode: d.mode || 'signin', onSession: startCloudSession }),
  startLocal: () => { store.startLocal(); ensureDefaults(); },
  startDemo: () => { store.startLocal(); ensureDefaults(); loadDemo(); },
  async signOut() {
    const ok = await confirmSheet({ title: store.mode === 'cloud' ? 'Sign out?' : 'Leave device mode?', body: store.mode === 'cloud' ? 'A copy of your data stays cached on this device. Unsynced changes are kept and sent next time you sign in.' : 'Your data stays on this device. You can come back to it, or sign in to an account.', ok: 'Sign out' });
    if (ok) await store.signOut();
  },
  async syncNow() { await store.syncNow({ pull: true }); ensureDefaults(); toast(store.sync.status === 'synced' ? 'Synced' : store.sync.error || 'Sync failed'); },

  loadDemo: () => loadDemo(),
  async removeDemo() {
    const ok = await confirmSheet({ title: 'Remove sample data?', body: 'Deletes every sample transaction, bill, income source, budget and goal. Anything you entered yourself is kept.', ok: 'Remove', danger: true });
    if (ok) { store.removeDemo(); toast('Sample data removed'); }
  },
  async wipe() {
    const ok = await confirmSheet({ title: 'Erase everything?', body: 'Every transaction, bill, budget and goal will be permanently deleted. Export a backup first if you might want it.', ok: 'Erase all', danger: true });
    if (!ok) return;
    store.wipe();
    store.batch(tx => { for (const c of defaultCategoryRows()) tx.upsert('categories', c); });
    toast('All data erased');
  },
  exportCsv: () => saveFile(`runway-transactions-${today()}.csv`, transactionsCSV(store.state), 'text/csv'),
  exportSummary: () => saveFile(`runway-monthly-summary-${today()}.csv`, summaryCSV(store.state, today()), 'text/csv'),
  backup: () => saveFile(`runway-backup-${today()}.json`, backupJSON(store.state), 'application/json'),
  restore: () => pickFile('.json,application/json', async text => {
    const data = parseBackup(text);
    const ok = await confirmSheet({ title: 'Restore this backup?', body: `Replaces everything currently here with ${data.transactions.length} transactions from ${esc((data.exportedAt || '').slice(0, 10))}.`, ok: 'Restore', danger: true });
    if (ok) { store.replaceAll(data); toast('Backup restored'); }
  }),
  importCsv: () => pickFile('.csv,text/csv', async text => {
    const res = importTransactions(text, store.state);
    const ok = await confirmSheet({ title: `Import ${res.transactions.length} transactions?`, body: `${res.categories.length ? `${res.categories.length} new categor${res.categories.length === 1 ? 'y' : 'ies'} will be created. ` : ''}${res.errors.length ? `${res.errors.length} row(s) skipped (bad date or amount).` : ''} Rows without a “type” column are imported as spending.`, ok: 'Import' });
    if (!ok) return;
    store.batch(tx => { for (const c of res.categories) tx.upsert('categories', c); for (const t of res.transactions) tx.upsert('transactions', t); });
    toast(`Imported ${res.transactions.length} transactions`);
  }),
};

function pickFile(accept, onText) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { await onText(await file.text()); } catch (e) { toast(e.message || 'Could not read that file', { ms: 4000 }); }
  };
  input.click();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = A[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  e.stopPropagation();
  Promise.resolve(fn(el.dataset, el, e)).catch(err => { console.error(err); toast(err.message || 'Something went wrong', { ms: 4000 }); });
});
document.addEventListener('input', e => {
  const k = e.target.dataset?.input;
  if (k === 'txSearch') { ui.tx.q = e.target.value; ui.txLimit = 250; render(); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset?.input;
  if (k === 'txCat') { ui.tx.cat = e.target.value; render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('toggle', e => {
  const k = e.target?.dataset?.key;
  if (k) { if (e.target.open) ui.openDetails.add(k); else ui.openDetails.delete(k); }
}, true);

/* Re-render when the date changes (app left open overnight) and sync when back online. */
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !store.mode) return;
  if (today() !== lastDay) {
    const oldMonth = monthKey(lastDay), newMonth = monthKey(today());
    lastDay = today();
    if (oldMonth !== newMonth) {
      // Screens that were on "this month" move to the new month.
      if (ui.month === oldMonth) ui.month = newMonth;
      if (ui.tx.month === oldMonth) ui.tx.month = newMonth;
      if (ui.calMonth === oldMonth) ui.calMonth = newMonth;
    }
    render();
  }
  if (store.mode === 'cloud') store.syncNow({ pull: true });
});
window.addEventListener('online', () => { if (store.mode === 'cloud') store.syncNow({ pull: true }); });

/* ---------------- boot ---------------- */
async function boot() {
  const saved = Store.savedMode();
  const params = new URLSearchParams(location.search);
  if (params.has('demo') && !saved) { A.startDemo(); return; }
  if (saved?.mode === 'local') { store.startLocal(); ensureDefaults(); return; }
  if (saved?.mode === 'cloud') {
    try {
      const { cloud } = await import('./cloud.js');
      const session = await cloud.session();
      if (session) { await store.startCloud(session); ensureDefaults(); return; }
    } catch (e) {
      // Offline and the auth library isn't cached: open the cached copy read/write.
      console.warn('cloud boot failed', e);
      store.startCloudCached({ id: saved.userId, email: saved.email });
      return;
    }
  }
  render();
}

// Handle password-recovery links (Supabase appends #type=recovery).
if (/type=recovery/.test(location.hash)) {
  import('./cloud.js').then(async ({ cloud }) => {
    const session = await cloud.session();
    if (session) { await startCloudSession(session); F.openPasswordForm(); }
  }).catch(() => {});
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
