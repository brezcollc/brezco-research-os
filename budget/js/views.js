/* views.js — every screen, rendered as HTML strings from engine output. */
import { store } from './store.js';
import { ui, today } from './ctx.js';
import { esc, icon } from './ui.js';
import { fmt, sum } from './money.js';
import {
  monthKey, addMonths, fmtMonth, fmtMonthShort, fmtDate, fmtDateDow, relDay, diffDays, addDays,
  monthStart, monthEnd, daysInMonthKey, weekday, dayOf, relDayFull,
} from './dates.js';
import { describeRule, nextOccurrence } from './schedule.js';
import {
  computeMonth, headline, STATUS, categoryIndex, incomeSummary, goalProgress, cashFlow,
  categoryBreakdown, monthlyEquivalent, budgetFor, billOccurrences, incomeOccurrences,
} from './engine.js';
import { ring, donut, bars, lines } from './charts.js';

const S = () => store.state;
const $ = (c, o) => `<span class="num">${fmt(c, o)}</span>`;
function big(c) {
  if (c === null || c === undefined) return '—';
  const s = fmt(c);
  const i = s.lastIndexOf('.');
  return `<span class="num">${s.slice(0, i)}<span class="cents">${s.slice(i)}</span></span>`;
}
const toneOf = st => (STATUS[st]?.tone || 'muted');
const pill = st => `<span class="pill ${toneOf(st) === 'good' ? '' : toneOf(st)}">${STATUS[st]?.label || st}</span>`;
const pctTxt = x => (x === Infinity ? '—' : `${Math.round(x * 100)}%`);
function monthNav(mk, act = 'month') {
  return `<div class="month-nav"><button type="button" data-act="${act}" data-d="-1" aria-label="Previous month">${icon('chevL')}</button>
    <div class="m">${fmtMonth(mk, false)}</div>
    <button type="button" data-act="${act}" data-d="1" aria-label="Next month">${icon('chevR')}</button></div>`;
}
const catLabel = (idx, id) => {
  if (!id) return 'Uncategorized';
  const c = idx.byId.get(id);
  if (!c) return 'Uncategorized';
  const p = c.parentId ? idx.byId.get(c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
};
const catIcon = (idx, id) => idx.byId.get(id)?.icon || '❔';
function barHTML(share, pace, tone, thick = false) {
  const w = Math.max(0, Math.min(1, share === Infinity ? 1 : share)) * 100;
  return `<div class="bar${thick ? ' thick' : ''}"><i class="${tone === 'good' ? '' : tone}" style="width:${w}%"></i>${pace !== null && pace > 0 && pace < 1 ? `<span class="pace" style="left:${pace * 100}%"></span>` : ''}</div>`;
}
function syncDot() {
  const s = store.sync.status;
  return `<span class="sync-dot ${s}" title="${esc(store.sync.error || s)}"></span>`;
}
function topbar(title, sub = '', right = '') {
  return `<div class="topbar"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div style="display:flex;gap:8px;align-items:center">${right}</div></div>`;
}

/* ====================================================================== */
/* DASHBOARD                                                              */
/* ====================================================================== */
export function dashboard() {
  const t = today(), st = S(), mk = monthKey(t);
  const m = computeMonth(st, mk, t);
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  let h = topbar(greet, `${fmtDateDow(t)} · Day ${m.dayOfMonth} of ${m.dim}`, `${syncDot()}<button class="icon-btn" data-act="tab" data-tab="settings" aria-label="Settings">${icon('gear')}</button>`);

  h += setupCard(st, m);

  /* ---- hero ---- */
  const c = m.cash;
  const tone = m.status === 'over' ? 'danger' : m.status === 'fast' ? 'warn' : '';
  h += `<section class="card hero ${tone ? `tone-${tone}` : ''}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span class="eyebrow">Safe to spend today</span>${pill(m.status)}
    </div>`;
  if (c) {
    h += `<div class="big">${big(c.perDay)}</div>
      <div class="meta"><span><b class="num">${fmt(c.safeMonth)}</b> left this month</span><span><b class="num">${fmt(c.perWeek)}</b> this week</span></div>
      <p class="say">${esc(headline(m))}</p>`;
  } else {
    h += `<div class="big">—</div><p class="say">Enter what's in your checking account right now. Everything else — safe-to-spend, projections, risk — builds on that real number.</p>
      <button class="btn primary sm" style="margin-top:12px" data-act="editBalance">Set current balance</button>`;
  }
  h += `</section>`;

  /* ---- discretionary ring ---- */
  const v = m.variable;
  const vTone = toneOf(v.status) === 'muted' ? 'good' : toneOf(v.status);
  h += `<section class="card" data-act="tab" data-tab="budget" style="cursor:pointer">
    <div class="card-h"><h2>Discretionary budget</h2><span class="link">Details ›</span></div>
    <div class="ring-wrap">
      <div class="ring">${ring({ share: v.usedShare === Infinity ? 1 : v.usedShare, pace: m.elapsedShare, tone: vTone })}
        <div class="center"><div class="pct num ${vTone === 'good' ? '' : vTone}">${v.budget ? pctTxt(v.usedShare) : '—'}</div><div class="lbl">used</div></div></div>
      <div class="ring-legend">
        <div class="row"><span class="k"><i class="dot" style="background:var(--${vTone === 'good' ? 'green' : vTone === 'warn' ? 'amber' : 'red'})"></i>Spent</span><b>${$(v.spent)}</b></div>
        <div class="row"><span class="k"><i class="dot" style="background:rgba(148,163,184,.3)"></i>Budget</span><b>${$(v.budget)}</b></div>
        <div class="row"><span class="k"><i class="dot" style="background:#fff;opacity:.8"></i>Month gone</span><b>${pctTxt(m.elapsedShare)}</b></div>
        <div class="row"><span class="k">At this pace</span><b class="${v.projected > v.budget ? 'danger' : ''}">${$(v.projected)}</b></div>
      </div>
    </div>
    <p class="explain">${v.budget ? (v.spent > v.budget ? `You're ${fmt(v.spent - v.budget)} over your discretionary budget.` : `${fmt(v.budget - v.spent)} of discretionary budget left for ${m.remainingDays} day${m.remainingDays === 1 ? '' : 's'}. The white tick shows where you'd be if spending were perfectly even.`) : 'Set budgets for categories like groceries and dining to track your pace.'}</p>
  </section>`;

  /* ---- stats ---- */
  h += `<div class="grid2">
    <button class="stat" data-act="openSeg" data-seg="income" style="text-align:left">
      <div class="label">Take-home received</div><div class="value num good">${fmt(m.income.receivedCents)}</div>
      <div class="foot">of ${fmt(m.income.expectedCents)} expected</div></button>
    <button class="stat" data-act="tab" data-tab="analytics" style="text-align:left">
      <div class="label">Spent this month</div><div class="value num">${fmt(m.spending.totalSpent)}</div>
      <div class="foot">Fixed ${fmt(m.spending.fixedSpent, { showCents: false })} · Variable ${fmt(m.spending.variableSpent, { showCents: false })}</div></button>
    <button class="stat" data-act="openSeg" data-seg="cashflow" style="text-align:left">
      <div class="label">Available to spend</div><div class="value num">${c ? fmt(c.safeMonth) : '—'}</div>
      <div class="foot">${c ? (c.limitedBy === 'cash' ? 'Limited by cash on hand' : 'Budget left, cash-backed') : 'Set your balance'}</div></button>
    <button class="stat" data-act="openSeg" data-seg="goals" style="text-align:left">
      <div class="label">Saved this month</div><div class="value num info">${fmt(m.savings.done)}</div>
      <div class="foot">${m.savings.plan ? `of ${fmt(m.savings.plan)} planned` : 'No savings plan set'}</div></button>
  </div>`;

  /* ---- spending vs plan ---- */
  const plannedTotal = m.plannedSpend;
  const committed = m.spending.totalSpent + m.bills.committedCents;
  h += `<section class="card">
    <div class="card-h"><h2>Spending vs. monthly budget</h2><span class="muted num" style="font-size:13px">${fmt(m.spending.totalSpent)} / ${fmt(plannedTotal)}</span></div>
    ${barHTML(plannedTotal ? m.spending.totalSpent / plannedTotal : 0, m.elapsedShare, m.spending.totalSpent > plannedTotal ? 'danger' : 'good', true)}
    <div class="kv" style="margin-top:10px"><span class="k">Already spent</span><span class="v num">${fmt(m.spending.totalSpent)}</span></div>
    <div class="kv"><span class="k">Committed to unpaid bills</span><span class="v num">${fmt(m.bills.committedCents)}</span></div>
    <div class="kv total"><span class="k">Spent + committed</span><span class="v num ${committed > plannedTotal ? 'danger' : ''}">${fmt(committed)}</span></div>
  </section>`;

  /* ---- projection ---- */
  if (m.projection && m.projection.endBalanceAtPace !== null) {
    const p = m.projection;
    h += `<section class="card">
      <div class="card-h"><h2>Projected month-end balance</h2><span class="chip">${fmtDate(monthEnd(mk))}</span></div>
      <div class="num ${p.endBalanceAtPace < 0 ? 'danger' : ''}" style="font-size:32px;font-weight:740;letter-spacing:-.03em">${fmt(p.endBalanceAtPace)}</div>
      <div class="muted" style="font-size:13px;margin-bottom:8px">if you keep spending at your current pace</div>
      <div class="kv"><span class="k">If you spend exactly your budget</span><span class="v num">${fmt(p.endBalanceOnBudget)}</span></div>
      <div class="kv"><span class="k">If no more income arrives</span><span class="v num ${p.endBalanceConfirmedOnly < 0 ? 'danger' : ''}">${fmt(p.endBalanceConfirmedOnly)}</span></div>
      <p class="explain">Starts from your actual balance (${fmt(c.balanceNow)}), adds ${fmt(m.income.pendingCents)} of expected pay, subtracts ${fmt(m.bills.committedCents)} in unpaid bills, ${fmt(m.savings.remaining)} of savings still to move and ${fmt(Math.max(0, p.variableAtPace - m.variable.spent))} of projected spending.</p>
    </section>`;
  }

  /* ---- insights ---- */
  const ins = m.insights;
  if (ins.length) {
    const showAll = ui.showAllInsights;
    h += `<div class="section-title">What needs attention</div><div class="list">${(showAll ? ins : ins.slice(0, 4)).map(insightHTML).join('')}
      ${ins.length > 4 ? `<button class="row-item" data-act="toggleInsights" style="justify-content:center;min-height:44px;color:var(--green);font-weight:600">${showAll ? 'Show less' : `Show all ${ins.length}`}</button>` : ''}</div>`;
  }

  /* ---- upcoming ---- */
  h += upcomingCard(st, m, t);

  /* ---- how it's calculated ---- */
  if (c) {
    h += `<details class="card"><summary style="font-weight:650;cursor:pointer;list-style:none;display:flex;justify-content:space-between">How “safe to spend” is calculated <span class="muted">›</span></summary>
      <div style="margin-top:12px">
      <div class="kv"><span class="k">Actual balance (confirmed)</span><span class="v num">${fmt(c.balanceNow)}</span></div>
      <div class="kv"><span class="k">+ Expected income still to come</span><span class="v num good">${fmt(m.income.pendingCents)}</span></div>
      <div class="kv"><span class="k">− Unpaid bills this month</span><span class="v num">${fmt(-m.bills.committedCents)}</span></div>
      <div class="kv"><span class="k">− Savings still to move</span><span class="v num">${fmt(-m.savings.remaining)}</span></div>
      <div class="kv"><span class="k">− Safety buffer</span><span class="v num">${fmt(-m.buffer)}</span></div>
      <div class="kv total"><span class="k">Cash free through ${fmtDate(monthEnd(mk))}</span><span class="v num">${fmt(c.monthCapacity)}</span></div>
      <div class="kv"><span class="k">Discretionary budget left</span><span class="v num">${fmt(m.variable.budgetRemaining)}</span></div>
      <div class="kv total"><span class="k">Safe to spend (lower of the two)</span><span class="v num good">${fmt(c.safeMonth)}</span></div>
      <div class="kv"><span class="k">÷ ${m.remainingDays} days left (incl. today)</span><span class="v num">${fmt(c.perDayMonth)}/day</span></div>
      ${c.untilPay ? `<div class="kv"><span class="k">Cash-only limit until payday (${c.untilPay.days}d)</span><span class="v num">${fmt(c.untilPay.perDay)}/day</span></div>` : ''}
      <p class="explain">Expected pay is only used for the month total. The “until payday” limit uses money you actually have — so a late or smaller paycheck can't leave you short.</p>
      </div></details>`;
  }
  return h;
}

function insightHTML(i) {
  const mark = { danger: '!', warn: '!', info: 'i', good: '✓' }[i.level];
  let acts = '';
  if (i.action?.type === 'payBill') acts = `<div class="acts"><button class="btn xs primary" data-act="payBill" data-bill="${i.action.billId}" data-date="${i.action.date}">Mark paid</button></div>`;
  if (i.action?.type === 'receiveIncome') acts = `<div class="acts"><button class="btn xs primary" data-act="receiveIncome" data-source="${i.action.sourceId}" data-date="${i.action.date}">Yes, it arrived</button></div>`;
  const tap = i.categoryId && i.categoryId !== '_uncat' ? ` data-act="openCategory" data-id="${i.categoryId}" style="cursor:pointer"` : '';
  return `<div class="insight ${i.level}"${tap}><div class="mark">${mark}</div><div><div class="t">${esc(i.title)}</div><div class="b">${esc(i.body)}</div>${acts}</div></div>`;
}

function setupCard(st, m) {
  const steps = [
    { done: st.settings.balanceCents !== null && st.settings.balanceCents !== undefined, label: 'Set your current balance', sub: 'What your checking account shows right now', act: 'editBalance' },
    { done: st.incomeSources.length > 0, label: 'Add your paycheck', sub: 'Take-home amount and pay schedule', act: 'newIncome' },
    { done: st.bills.length > 0, label: 'Add recurring bills', sub: 'Rent, utilities, phone, subscriptions…', act: 'newBill' },
    { done: st.budgets.some(b => b.amountCents > 0), label: 'Set spending budgets', sub: 'Groceries, dining, shopping…', act: 'openSeg', seg: 'spending' },
  ];
  if (steps.every(s => s.done) || ui.dismissSetup) return '';
  const n = steps.filter(s => s.done).length;
  return `<section class="card"><div class="card-h"><h2>Get set up · ${n}/4</h2><button class="link" data-act="dismissSetup" style="color:var(--dim)">Hide</button></div>
    <div class="steps" style="margin:0 -16px">${steps.map(s => `<button class="row-item" data-act="${s.act}" ${s.seg ? `data-seg="${s.seg}"` : ''}>
      <div class="ico ${s.done ? 'done' : ''}">${s.done ? icon('check') : '○'}</div><div class="main"><div class="title" style="${s.done ? 'color:var(--muted);text-decoration:line-through' : ''}">${s.label}</div><div class="subt">${s.sub}</div></div><span class="chev">${icon('chevR')}</span></button>`).join('')}</div>
    ${!store.hasDemo() && st.transactions.length === 0 ? `<div class="divider">or</div><button class="btn block" data-act="loadDemo">Explore with sample data</button>` : ''}
  </section>`;
}

function upcomingCard(st, m, t) {
  const pay = m.cash?.untilPay?.payday || null;
  const horizon = addDays(t, 21);
  const bills = billOccurrences(st, monthStart(monthKey(t)), horizon).filter(o => !o.paid).slice(0, 6);
  if (!pay && !bills.length) return '';
  let h = `<div class="section-title">Coming up</div><section class="card">`;
  if (pay) {
    h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div><div class="eyebrow">Next paycheck</div><div style="font-size:20px;font-weight:720;margin-top:2px">${relDayFull(pay.date, t)}</div><div class="muted" style="font-size:13px">${esc(pay.name)}</div></div>
      <div style="text-align:right"><div class="num good" style="font-size:20px;font-weight:720">+${fmt(pay.expectedCents)}</div><span class="chip info">Expected</span></div></div>`;
    const u = m.cash.untilPay;
    h += `<div class="banner ${u.shortfall > 0 ? 'danger' : m.cash.tightBeforePayday ? 'warn' : 'good'}" style="margin:14px 0 4px">${u.shortfall > 0
      ? `Bills due before payday (${fmt(u.billsDueCents)}) are more than you have. You're ${fmt(u.shortfall)} short.`
      : `After ${u.billsDue.length ? `${u.billsDue.length} bill${u.billsDue.length === 1 ? '' : 's'} due before payday (${fmt(u.billsDueCents)})` : 'upcoming bills'}, you'll have <b class="num">${fmt(Math.max(0, u.freeCents))}</b> free until your paycheck — about ${fmt(u.perDay)}/day.`}</div>`;
  }
  if (bills.length) {
    h += `<div style="margin:8px -16px -16px">${bills.map(o => `<div class="row-item"><div class="ico">${catIcon(categoryIndex(st), o.categoryId)}</div>
      <div class="main"><div class="title">${esc(o.name)}</div><div class="subt ${o.date < t ? 'warn' : ''}">${o.date < t ? `Overdue · was due ${fmtDate(o.date)}` : `Due ${relDayFull(o.date, t)}`}${o.bill.autopay ? ' · Autopay' : ''}</div></div>
      <div class="amt num">${fmt(o.amountCents)}</div>
      <button class="btn xs" data-act="payBill" data-bill="${o.billId}" data-date="${o.date}">Pay</button></div>`).join('')}</div>`;
  }
  h += `</section><button class="btn block ghost" data-act="openSeg" data-seg="cashflow" style="margin-top:-4px;color:var(--green)">${icon('cal')} Open cash-flow calendar</button>`;
  return h;
}

/* ====================================================================== */
/* TRANSACTIONS                                                           */
/* ====================================================================== */
export function transactions() {
  const st = S(), idx = categoryIndex(st), f = ui.tx;
  const q = f.q.trim().toLowerCase();
  let list = st.transactions;
  if (!q) list = list.filter(t => monthKey(t.date) === f.month);
  if (f.kind !== 'all') list = list.filter(t => f.kind === 'income' ? t.kind === 'income' : t.kind === 'expense' && (f.kind === 'savings' ? idx.kindOf(t.categoryId) === 'savings' : idx.kindOf(t.categoryId) !== 'savings'));
  if (f.cat) list = list.filter(t => t.categoryId === f.cat || idx.root(t.categoryId)?.id === f.cat);
  if (q) list = list.filter(t => [t.merchant, t.notes, catLabel(idx, t.categoryId), fmt(t.amountCents)].join(' ').toLowerCase().includes(q));
  list = list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '')));

  const out = sum(list.filter(t => t.kind === 'expense' && idx.kindOf(t.categoryId) !== 'savings'), t => t.amountCents);
  const inc = sum(list.filter(t => t.kind === 'income'), t => t.amountCents);

  let h = topbar('Transactions', q ? `Searching all months` : fmtMonth(f.month), q ? '' : monthNav(f.month, 'txMonth'));
  h += `<div class="search">${icon('search')}<input class="input" type="search" placeholder="Search merchant, note, amount" value="${esc(f.q)}" data-input="txSearch" autocomplete="off"></div>`;
  h += `<div class="seg">${[['all', 'All'], ['spending', 'Spending'], ['income', 'Income'], ['savings', 'Savings']].map(([k, l]) => `<button class="${f.kind === k ? 'on' : ''}" data-act="txKind" data-k="${k}">${l}</button>`).join('')}
    <select class="input" data-input="txCat" style="height:34px;width:auto;border-radius:999px;font-size:14px;padding:0 34px 0 14px;background-position:calc(100% - 18px) 15px,calc(100% - 13px) 15px">
      <option value="">All categories</option>${idx.roots.filter(c => !c.archived).map(c => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}</select></div>`;
  h += `<div class="grid2"><div class="stat"><div class="label">Money out</div><div class="value num">${fmt(out)}</div><div class="foot">${list.filter(t => t.kind === 'expense').length} transactions</div></div>
    <div class="stat"><div class="label">Money in</div><div class="value num good">${fmt(inc)}</div><div class="foot">${list.filter(t => t.kind === 'income').length} deposits</div></div></div>`;

  if (!list.length) {
    h += `<div class="card empty"><div class="e">🧾</div><h3>No transactions${q ? ' found' : ' yet'}</h3><p>${q ? 'Try a different search.' : 'Tap + to log spending in a couple of seconds.'}</p>${q ? '' : `<button class="btn primary" data-act="addTx">Add transaction</button>`}</div>`;
    return h;
  }
  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const td = today();
  let shown = 0;
  for (const [d, items] of groups) {
    if (shown > (ui.txLimit || 250)) break;
    const dayOut = sum(items.filter(t => t.kind === 'expense'), t => t.amountCents);
    h += `<div class="day-h"><span>${relDay(d, td) === fmtDate(d) ? fmtDateDow(d) : `${relDay(d, td)} · ${fmtDate(d)}`}${q ? ` ${d.slice(0, 4)}` : ''}</span><span class="num">${dayOut ? fmt(-dayOut) : ''}</span></div><div class="list">`;
    h += items.map(t => txRow(t, idx)).join('');
    h += `</div>`;
    shown += items.length;
  }
  if (shown < list.length) h += `<button class="btn block" data-act="txMore">Show more</button>`;
  return h;
}

export function txRow(t, idx) {
  const isInc = t.kind === 'income';
  const sav = !isInc && idx.kindOf(t.categoryId) === 'savings';
  const refund = !isInc && t.amountCents < 0;
  const title = t.merchant || (isInc ? (S().incomeSources.find(s => s.id === t.incomeSourceId)?.name || 'Income') : catLabel(idx, t.categoryId));
  const subBits = [];
  if (isInc) subBits.push(S().incomeSources.find(s => s.id === t.incomeSourceId)?.name || 'Income');
  else subBits.push(catLabel(idx, t.categoryId));
  if (t.billId) subBits.push('Bill payment');
  if (t.goalId) subBits.push(S().goals.find(g => g.id === t.goalId)?.name || 'Goal');
  if (t.notes) subBits.push(t.notes);
  const amt = isInc ? `<span class="good">+${fmt(t.amountCents)}</span>` : refund ? `<span class="good">+${fmt(-t.amountCents)}</span>` : sav ? `<span class="info">${fmt(t.amountCents)}</span>` : fmt(-t.amountCents);
  return `<button class="row-item" data-act="editTx" data-id="${t.id}"><div class="ico">${isInc ? '💵' : esc(catIcon(idx, t.categoryId))}</div>
    <div class="main"><div class="title">${esc(title)}</div><div class="subt">${esc(subBits.join(' · '))}</div></div>
    <div class="amt num">${amt}</div></button>`;
}

/* ====================================================================== */
/* BUDGET                                                                 */
/* ====================================================================== */
const SEGS = [['spending', 'Spending'], ['bills', 'Bills'], ['income', 'Income'], ['goals', 'Goals'], ['cashflow', 'Cash flow']];

export function budget() {
  const seg = ui.seg;
  const right = seg === 'goals' || seg === 'cashflow' ? '' : monthNav(ui.month);
  let h = topbar('Budget', seg === 'cashflow' ? 'Next 6 weeks' : seg === 'goals' ? 'Savings & goals' : fmtMonth(ui.month), right);
  h += `<div class="seg">${SEGS.map(([k, l]) => `<button class="${seg === k ? 'on' : ''}" data-act="seg" data-seg="${k}">${l}</button>`).join('')}</div>`;
  if (seg === 'spending') h += spendingSeg();
  if (seg === 'bills') h += billsSeg();
  if (seg === 'income') h += incomeSeg();
  if (seg === 'goals') h += goalsSeg();
  if (seg === 'cashflow') h += cashflowSeg();
  return h;
}

function spendingSeg() {
  const st = S(), t = today(), mk = ui.month;
  const m = computeMonth(st, mk, t);
  let h = '';
  // Plan check
  const un = m.unallocated;
  h += `<section class="card"><div class="card-h"><h2>Monthly plan</h2>${m.phase === 'current' ? pill(m.status) : m.phase === 'past' ? '<span class="chip">Closed</span>' : '<span class="chip info">Upcoming</span>'}</div>
    <div class="kv"><span class="k">${m.phase === 'past' ? 'Income received' : 'Expected take-home'}</span><span class="v num good">${fmt(m.planIncome)}</span></div>
    <div class="kv"><span class="k">Fixed bills</span><span class="v num">${fmt(-m.bills.plannedCents)}</span></div>
    <div class="kv"><span class="k">Savings</span><span class="v num">${fmt(-m.savings.plan)}</span></div>
    <div class="kv"><span class="k">Discretionary budgets</span><span class="v num">${fmt(-m.variable.budget)}</span></div>
    <div class="kv total"><span class="k">${un >= 0 ? 'Not yet assigned' : 'Over-committed'}</span><span class="v num ${un < 0 ? 'danger' : 'good'}">${fmt(un)}</span></div>
    <p class="explain">${un < 0 ? `Your plan spends ${fmt(-un)} more than you'll take home. Lower a budget or your savings target.` : un > 0 ? `${fmt(un)} of income has no job yet. Consider adding it to savings or a goal.` : 'Every dollar is assigned.'}</p></section>`;

  // Variable categories
  const vl = m.lines.filter(l => l.kind === 'variable');
  h += `<div class="section-title" style="display:flex;justify-content:space-between"><span>Discretionary · ${fmt(m.variable.spent)} of ${fmt(m.variable.budget)}</span></div>`;
  h += `<div class="list">${vl.map(l => catRowHTML(l, m)).join('') || `<div class="empty"><p>No discretionary categories.</p></div>`}</div>`;
  // Savings
  const sl = m.lines.filter(l => l.kind === 'savings');
  if (sl.length) {
    h += `<div class="section-title">Savings · ${fmt(m.savings.done)} of ${fmt(m.savings.plan)}</div><div class="list">${sl.map(l => catRowHTML(l, m)).join('')}</div>`;
  }
  // Fixed
  const fl = m.lines.filter(l => l.kind === 'fixed' && (l.budget || l.spent));
  h += `<div class="section-title">Fixed · ${fmt(m.spending.fixedSpent)} paid, ${fmt(m.bills.committedCents)} still due</div>`;
  h += `<div class="list">${fl.map(l => `<button class="cat-row" data-act="openCategory" data-id="${l.category.id}">
      <div class="top"><span class="ico">${esc(l.category.icon || '•')}</span><span class="name">${esc(l.category.name)}</span><span class="figs num"><b>${fmt(l.spent)}</b> <span class="muted">/ ${fmt(l.budget)}</span></span></div>
      ${barHTML(l.budget ? l.spent / l.budget : 0, null, l.spent > l.budget ? 'danger' : 'good')}
      <div class="note"><span>${l.bills.length} bill${l.bills.length === 1 ? '' : 's'}${l.committed ? ` · ${fmt(l.committed)} due` : l.bills.length ? ' · all paid' : ''}</span></div></button>`).join('') || `<div class="empty"><p>No bills this month.</p><button class="btn sm" data-act="newBill">Add a bill</button></div>`}</div>`;
  h += `<button class="btn block" data-act="newCategory">${icon('plus')} New category</button>`;
  return h;
}

function catRowHTML(l, m) {
  const c = l.category;
  let note = '', tone = toneOf(l.status);
  if (l.kind === 'savings') {
    note = l.status === 'funded' ? `<span class="good">Funded${l.spent > l.budget ? ` · ${fmt(l.spent - l.budget)} extra` : ''}</span>` : `<span>${fmt(Math.max(0, l.budget - l.spent))} still to move</span>`;
    tone = l.status === 'funded' ? 'good' : 'muted';
    return `<button class="cat-row" data-act="openCategory" data-id="${c.id}">
      <div class="top"><span class="ico">${esc(c.icon || '•')}</span><span class="name">${esc(c.name)}</span><span class="figs num"><b>${fmt(l.spent)}</b> <span class="muted">/ ${fmt(l.budget)}</span></span></div>
      ${barHTML(l.budget ? l.spent / l.budget : 0, null, l.status === 'funded' ? 'good' : 'muted')}<div class="note">${note}<span class="chip ${l.status === 'funded' ? 'good' : ''}">${STATUS[l.status].label}</span></div></button>`;
  }
  if (m.phase === 'future') note = `<span>Budget ${fmt(l.budget)}</span>`;
  else if (l.budget === 0 && l.spent === 0) note = `<span class="dim">No budget set — tap to add</span>`;
  else if (l.status === 'over') note = `<span class="danger">${l.budget ? `Over by ${fmt(l.spent - l.budget)}` : 'No budget set'}</span>`;
  else if (m.phase === 'past') note = `<span class="good">${fmt(l.budget - l.spent)} under budget</span>`;
  else if (l.status === 'fast') note = `<span class="warn">Projected ${fmt(l.projected)} · ${fmt(l.dailyAllowance)}/day left</span>`;
  else note = `<span>${fmt(l.remaining)} left · ${fmt(l.dailyAllowance)}/day</span>`;
  const chip = m.phase === 'future' || (l.budget === 0 && l.spent === 0) ? '' : `<span class="chip ${tone === 'good' ? 'good' : tone}">${STATUS[l.status].label}</span>`;
  return `<button class="cat-row" data-act="openCategory" data-id="${c.id}">
    <div class="top"><span class="ico">${esc(c.icon || '•')}</span><span class="name">${esc(c.name)}</span><span class="figs num"><b>${fmt(l.spent)}</b> <span class="muted">/ ${fmt(l.budget)}</span></span></div>
    ${barHTML(l.usedShare, m.phase === 'current' ? m.elapsedShare : null, tone === 'muted' ? 'good' : tone)}
    <div class="note">${note}${chip}</div></button>`;
}

function billsSeg() {
  const st = S(), t = today(), mk = ui.month, idx = categoryIndex(st);
  const occ = billOccurrences(st, monthStart(mk), monthEnd(mk));
  const paid = occ.filter(o => o.paid), due = occ.filter(o => !o.paid);
  const monthlyEq = sum(st.bills.filter(b => b.active !== false), b => monthlyEquivalent(b));
  let h = `<div class="grid2">
    <div class="stat"><div class="label">Bills in ${fmtMonthShort(mk)}</div><div class="value num">${fmt(sum(occ, o => o.paid ? o.tx.amountCents : o.amountCents))}</div><div class="foot">${occ.length} payments</div></div>
    <div class="stat"><div class="label">${mk < monthKey(t) ? 'Unpaid' : 'Still due'}</div><div class="value num ${due.some(o => o.date < t) ? 'warn' : ''}">${fmt(sum(due, o => o.amountCents))}</div><div class="foot">${paid.length} paid · ${due.length} open</div></div></div>`;
  h += `<p class="explain" style="margin:-2px 4px 14px">All recurring bills average <b class="num" style="color:var(--text)">${fmt(monthlyEq)}</b>/month (yearly and quarterly bills spread evenly).</p>`;
  if (occ.length) {
    h += `<div class="list">${occ.map(o => {
      const st2 = o.paid ? `<span class="chip good">Paid ${fmtDate(o.tx.date)}</span>` : o.date < t ? `<span class="chip warn">Overdue</span>` : `<span class="chip">Due ${relDay(o.date, t)}</span>`;
      return `<div class="row-item"><div class="ico">${esc(catIcon(idx, o.categoryId))}</div>
        <button class="main" data-act="editBill" data-id="${o.billId}" style="text-align:left"><div class="title">${esc(o.name)}</div><div class="subt">${fmtDate(o.date)} · ${esc(describeRule(o.bill))}${o.bill.autopay ? ' · Autopay' : ''}</div></button>
        <div class="amt num">${fmt(o.paid ? o.tx.amountCents : o.amountCents)}<small>${st2}</small></div>
        ${o.paid ? `<button class="icon-btn" data-act="editTx" data-id="${o.tx.id}" aria-label="Edit payment">${icon('edit')}</button>` : `<button class="btn xs primary" data-act="payBill" data-bill="${o.billId}" data-date="${o.date}">Pay</button>`}</div>`;
    }).join('')}</div>`;
  } else h += `<div class="card empty"><div class="e">🧾</div><h3>No bills this month</h3><p>Add rent, utilities, phone, insurance, subscriptions and loan payments.</p></div>`;
  const all = st.bills.slice().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  if (all.length) {
    h += `<div class="section-title">All recurring bills</div><div class="list">${all.map(b => {
      const n = b.active === false ? null : nextOccurrence(b, t);
      return `<button class="row-item" data-act="editBill" data-id="${b.id}" style="${b.active === false ? 'opacity:.5' : ''}"><div class="ico">${esc(catIcon(idx, b.categoryId))}</div>
      <div class="main"><div class="title">${esc(b.name)}</div><div class="subt">${esc(describeRule(b))}${n ? ` · next ${fmtDate(n)}` : b.active === false ? ' · paused' : ''}</div></div>
      <div class="amt num">${fmt(b.amountCents)}<small>${b.frequency !== 'monthly' && b.frequency !== 'once' ? `≈ ${fmt(monthlyEquivalent(b))}/mo` : ''}</small></div><span class="chev">${icon('chevR')}</span></button>`;
    }).join('')}</div>`;
  }
  h += `<button class="btn block primary" data-act="newBill">${icon('plus')} Add recurring bill</button>`;
  return h;
}

function incomeSeg() {
  const st = S(), t = today(), mk = ui.month;
  const m = computeMonth(st, mk, t);
  const sum12 = incomeSummary(st, t);
  let h = `<section class="card"><div class="card-h"><h2>${fmtMonth(mk)}</h2>${m.income.pendingOverdue.length ? '<span class="chip warn">Needs confirming</span>' : ''}</div>
    <div class="grid2" style="margin:0">
      <div><div class="eyebrow">Received</div><div class="num good" style="font-size:24px;font-weight:740">${fmt(m.income.receivedCents)}</div><div class="dim" style="font-size:12px">confirmed, in your balance</div></div>
      <div><div class="eyebrow">${m.phase === 'past' ? 'Missed / unconfirmed' : 'Still expected'}</div><div class="num info" style="font-size:24px;font-weight:740">${fmt(m.phase === 'past' ? sum(m.income.occurrences.filter(o => !o.received), o => o.expectedCents) : m.income.pendingCents)}</div><div class="dim" style="font-size:12px">not counted as available yet</div></div>
    </div>
    ${barHTML(m.income.expectedCents ? m.income.receivedCents / m.income.expectedCents : 0, null, 'good')}
  </section>`;
  if (m.income.occurrences.length) {
    h += `<div class="section-title">Paydays this month</div><div class="list">${m.income.occurrences.map(o => `<div class="row-item">
      <div class="ico">${o.received ? '✅' : o.date < t ? '⏳' : '🗓️'}</div>
      <div class="main"><div class="title">${esc(o.name)}</div><div class="subt">${fmtDateDow(o.date)} · ${o.received ? `received ${fmt(o.tx.amountCents)}` : o.date < t ? 'not confirmed yet' : relDay(o.date, t)}</div></div>
      <div class="amt num ${o.received ? 'good' : 'muted'}">${fmt(o.received ? o.tx.amountCents : o.expectedCents)}</div>
      ${o.received ? `<button class="icon-btn" data-act="editTx" data-id="${o.tx.id}" aria-label="Edit">${icon('edit')}</button>` : o.date <= t ? `<button class="btn xs primary" data-act="receiveIncome" data-source="${o.sourceId}" data-date="${o.date}">Confirm</button>` : `<button class="btn xs" data-act="receiveIncome" data-source="${o.sourceId}" data-date="${o.date}">Got it</button>`}
    </div>`).join('')}</div>`;
  }
  const extra = m.income.transactions.filter(x => !x.incomeSourceId || !x.incomeDate);
  if (extra.length) {
    const idx = categoryIndex(st);
    h += `<div class="section-title">Other income received</div><div class="list">${extra.map(x => txRow(x, idx)).join('')}</div>`;
  }
  h += `<div class="section-title">Projected take-home</div><section class="card">
    <div class="kv"><span class="k">This month (scheduled)</span><span class="v num">${fmt(sum12.thisMonthCents)}</span></div>
    <div class="kv"><span class="k">Typical month (average)</span><span class="v num">${fmt(sum12.monthlyAvgCents)}</span></div>
    <div class="kv"><span class="k">Calendar ${sum12.year}</span><span class="v num">${fmt(sum12.yearCents)}</span></div>
    <div class="kv total"><span class="k">Next 12 months</span><span class="v num good">${fmt(sum12.next12Cents)}</span></div>
    <p class="explain">Biweekly pay means two months a year have three paychecks — they're counted on their actual dates, not averaged.</p></section>`;
  h += `<div class="section-title">Income sources</div><div class="list">${sum12.sources.map(x => `<button class="row-item" data-act="editIncome" data-id="${x.source.id}">
      <div class="ico">${{ paycheck: '💼', bonus: '🎉', side: '🧑‍💻', other: '💵' }[x.source.kind] || '💵'}</div>
      <div class="main"><div class="title">${esc(x.source.name)}</div><div class="subt">${esc(describeRule(x.source))}${x.next ? ` · next ${fmtDate(x.next)}` : ''}</div></div>
      <div class="amt num">${fmt(x.perPaycheck)}<small>${x.source.frequency === 'once' ? 'one time' : `≈ ${fmt(x.monthlyAvgCents, { showCents: false })}/mo`}</small></div><span class="chev">${icon('chevR')}</span></button>`).join('')
    || `<div class="empty"><p>No income sources yet.</p></div>`}
    ${st.incomeSources.filter(s => s.active === false).map(s => `<button class="row-item" data-act="editIncome" data-id="${s.id}" style="opacity:.5"><div class="ico">💤</div><div class="main"><div class="title">${esc(s.name)}</div><div class="subt">Paused</div></div><span class="chev">${icon('chevR')}</span></button>`).join('')}</div>
    <div class="btn-row"><button class="btn primary" data-act="newIncome">${icon('plus')} Income source</button><button class="btn" data-act="addTx" data-kind="income">Log one-off</button></div>`;
  return h;
}

function goalsSeg() {
  const st = S(), t = today();
  const goals = st.goals.filter(g => !g.archived);
  let h = '';
  if (!goals.length) {
    h += `<div class="card empty"><div class="e">🎯</div><h3>Set a savings goal</h3><p>Emergency fund, a trip, a big purchase — see exactly how much to set aside from each paycheck.</p></div>`;
  }
  for (const g of goals) {
    const p = goalProgress(st, g, t);
    h += `<section class="card goal-card"><div class="top"><div class="ico">${esc(g.icon || '🎯')}</div>
      <div style="flex:1;min-width:0"><div style="font-weight:680;font-size:16px">${esc(g.name)}</div><div class="muted" style="font-size:12.5px">${p.kind === 'monthly' ? `Every month · ${fmtMonth(monthKey(t))}` : g.targetDate ? `By ${fmtDate(g.targetDate)} ${g.targetDate.slice(0, 4)}` : 'No deadline'}</div></div>
      <button class="icon-btn" data-act="editGoal" data-id="${g.id}" aria-label="Edit goal">${icon('edit')}</button></div>
      ${barHTML(p.share, null, p.done ? 'good' : 'good', true)}
      <div class="figs"><span><b class="num" style="color:var(--text);font-size:16px">${fmt(p.saved)}</b> of ${fmt(p.target)}</span><span>${Math.round(p.share * 100)}%</span></div>`;
    if (p.kind === 'monthly') {
      h += `<p class="explain">${p.done ? `Done for this month — ${fmt(p.saved)} moved to savings.` : `${fmt(p.remaining)} more to move to savings this month.`}</p>`;
    } else if (p.done) {
      h += `<p class="explain good">Goal reached. 🎉</p>`;
    } else {
      h += `<div class="need">
        <div><div class="l">Per paycheck</div><div class="v num">${p.perPaycheck !== null ? fmt(p.perPaycheck) : '—'}</div><div class="dim" style="font-size:11.5px">${p.paychecksLeft !== null ? `${p.paychecksLeft} paychecks left` : 'add a target date'}</div></div>
        <div><div class="l">Per month</div><div class="v num">${p.perMonth !== null ? fmt(p.perMonth) : '—'}</div><div class="dim" style="font-size:11.5px">${p.monthsLeft ? `${p.monthsLeft} months` : '—'}</div></div></div>
        <p class="explain">${p.pacePerMonth > 0 ? `At your recent pace (${fmt(p.pacePerMonth)}/mo) you'll get there around <b style="color:var(--text)">${fmtMonth(monthKey(p.eta))}</b>${p.onTrack === null ? '' : p.onTrack ? ' — on schedule.' : ' — behind schedule. Increase contributions to the per-paycheck amount above.'}` : `No contributions in the last few months. ${p.perPaycheck ? `Set aside ${fmt(p.perPaycheck)} each payday to finish on time.` : ''}`}</p>`;
    }
    h += `<div class="btn-row" style="margin-top:12px"><button class="btn sm primary" data-act="contribute" data-id="${g.id}">Add money</button><button class="btn sm" data-act="goalHistory" data-id="${g.id}">History</button></div></section>`;
  }
  // Emergency fund suggestion
  const fixedMonthly = sum(st.bills.filter(b => b.active !== false), b => monthlyEquivalent(b));
  const idx = categoryIndex(st);
  const groceries = idx.roots.find(c => /grocer/i.test(c.name));
  const essentials = fixedMonthly + (groceries ? budgetFor(st, groceries.id, monthKey(t)) : 0);
  if (essentials > 0 && !goals.some(g => /emergency/i.test(g.name))) {
    h += `<div class="banner info">Tip: an emergency fund of 3–6 months of essentials would be <b class="num">${fmt(essentials * 3)}–${fmt(essentials * 6)}</b> for you.</div>`;
  }
  h += `<button class="btn block primary" data-act="newGoal">${icon('plus')} New goal</button>`;
  const archived = st.goals.filter(g => g.archived);
  if (archived.length) h += `<div class="section-title">Archived</div><div class="list">${archived.map(g => `<button class="row-item" data-act="editGoal" data-id="${g.id}"><div class="ico">${esc(g.icon || '🎯')}</div><div class="main"><div class="title">${esc(g.name)}</div></div><span class="chev">${icon('chevR')}</span></button>`).join('')}</div>`;
  return h;
}

function cashflowSeg() {
  const st = S(), t = today();
  const cf = cashFlow(st, t, 42);
  if (!cf.hasBalance) {
    return `<div class="card empty"><div class="e">🏦</div><h3>Start with your real balance</h3><p>Cash flow projects forward from what's actually in your account today.</p><button class="btn primary" data-act="editBalance">Set current balance</button></div>`;
  }
  let h = '';
  const buffer = cf.buffer;
  const lowPay = cf.lowBeforePay;
  if (cf.firstShort) h += `<div class="banner danger">⚠️ At your planned spending, your balance would go below $0 on <b>${fmtDateDow(cf.firstShort)}</b>. Move money in or cut back before then.</div>`;
  else if (cf.firstBelowBuffer && buffer) h += `<div class="banner warn">Your balance dips under your ${fmt(buffer)} safety buffer on <b>${fmtDateDow(cf.firstBelowBuffer)}</b>.</div>`;
  else h += `<div class="banner good">You stay above ${buffer ? `your ${fmt(buffer)} buffer` : '$0'} for the next 6 weeks, even after bills and planned spending.</div>`;

  h += `<div class="grid2">
    <div class="stat"><div class="label">Actual balance</div><div class="value num">${fmt(cf.start)}</div><div class="foot">Confirmed money only</div></div>
    <div class="stat"><div class="label">Lowest projected</div><div class="value num ${cf.low.planned < 0 ? 'danger' : cf.low.planned < buffer ? 'warn' : ''}">${fmt(cf.low.planned)}</div><div class="foot">${fmtDateDow(cf.low.date)}</div></div></div>`;
  if (cf.payday) {
    h += `<div class="banner info">Next paycheck <b>${fmtDateDow(cf.payday.date)}</b> (${fmt(cf.payday.expectedCents)}, expected). ${lowPay ? `Lowest point before it arrives: <b class="num">${fmt(lowPay.planned)}</b>.` : ''}</div>`;
  }
  const sel = ui.chartSel.cf ?? null;
  const ser = cf.series;
  h += `<section class="card"><div class="card-h"><h2>Projected balance</h2></div>
    ${lines({ chartId: 'cf', sel, labels: ser.map(p => fmtDate(p.date)), refLine: buffer || null, series: [
      { name: 'Confirmed only', color: '#8d9ab2', values: ser.map(p => p.confirmed), dash: '3 3', width: 1.6 },
      { name: 'With expected pay', color: '#6ea8ff', values: ser.map(p => p.expected), width: 1.8 },
      { name: 'With planned spending', color: '#2fd18b', values: ser.map(p => p.planned), fill: true },
    ] })}
    <div class="chart-keys"><span><i class="dot" style="background:#8d9ab2"></i>Confirmed money only</span><span><i class="dot" style="background:#6ea8ff"></i>+ expected pay</span><span><i class="dot" style="background:#2fd18b"></i>+ planned spending</span></div>
    <div class="chart-tip">${sel !== null && ser[sel] ? `<b>${fmtDateDow(ser[sel].date)}</b> · planned ${fmt(ser[sel].planned)} · expected ${fmt(ser[sel].expected)} · confirmed ${fmt(ser[sel].confirmed)}` : 'Tap the chart to inspect a day.'}</div>
    <p class="explain">The grey line ignores all expected income — it shows what happens if a paycheck is late. Expected pay is never treated as money you have.</p></section>`;

  // Calendar
  const cm = ui.calMonth;
  const occInc = incomeOccurrences(st, monthStart(cm), monthEnd(cm));
  const occBill = billOccurrences(st, monthStart(cm), monthEnd(cm));
  const dayMap = new Map();
  for (const o of occInc) { if (!dayMap.has(o.date)) dayMap.set(o.date, []); dayMap.get(o.date).push(o); }
  for (const o of occBill) { if (!dayMap.has(o.date)) dayMap.set(o.date, []); dayMap.get(o.date).push(o); }
  const lowDays = new Set(ser.filter(p => p.planned < buffer).map(p => p.date));
  const first = weekday(monthStart(cm));
  const dim = daysInMonthKey(cm);
  let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++) cells += `<div class="d out"></div>`;
  for (let d = 1; d <= dim; d++) {
    const iso = `${cm}-${String(d).padStart(2, '0')}`;
    const ev = dayMap.get(iso) || [];
    const dots = ev.slice(0, 3).map(o => `<i style="background:${o.type === 'income' ? 'var(--green)' : o.paid ? 'var(--dim)' : 'var(--red)'}"></i>`).join('');
    cells += `<button class="d ${iso === t ? 'today' : ''} ${iso < t ? 'past' : ''} ${ui.calSel === iso ? 'sel' : ''} ${lowDays.has(iso) ? 'low' : ''}" data-act="calSel" data-date="${iso}">${d}<span class="dots">${dots}</span></button>`;
  }
  h += `<section class="card"><div class="card-h"><h2>Calendar</h2>${monthNav(cm, 'calMonth')}</div><div class="cal">${cells}</div>
    <div class="chart-keys"><span><i class="dot" style="background:var(--green)"></i>Payday</span><span><i class="dot" style="background:var(--red)"></i>Bill due</span><span><i class="dot" style="background:var(--dim)"></i>Paid</span></div>`;
  if (ui.calSel && monthKey(ui.calSel) === cm) {
    const ev = dayMap.get(ui.calSel) || [];
    const pt = ser.find(p => p.date === ui.calSel);
    h += `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px"><div style="font-weight:650;margin-bottom:6px">${fmtDateDow(ui.calSel)}</div>
      ${ev.length ? ev.map(o => `<div class="kv"><span class="k">${o.type === 'income' ? '💵' : '🧾'} ${esc(o.name)} ${o.type === 'income' ? (o.received ? '· received' : '· expected') : (o.paid ? '· paid' : '')}</span><span class="v num ${o.type === 'income' ? 'good' : ''}">${o.type === 'income' ? '+' + fmt(o.received ? o.tx.amountCents : o.expectedCents) : fmt(-(o.paid ? o.tx.amountCents : o.amountCents))}</span></div>`).join('') : '<div class="muted" style="font-size:13.5px">Nothing scheduled.</div>'}
      ${pt ? `<div class="kv total"><span class="k">Projected end of day</span><span class="v num">${fmt(pt.planned)}</span></div>` : ''}</div>`;
  }
  h += `</section>`;

  // Timeline
  const evs = cf.series.flatMap(p => p.events.map(e => ({ ...e, after: p })));
  h += `<div class="section-title">Upcoming money movements</div><section class="card tl">${evs.slice(0, 18).map(e => `<div class="tl-item">
    <div class="tl-date"><div class="d num">${dayOf(e.date)}</div><div class="m">${fmtMonthShort(monthKey(e.date))}</div></div>
    <div class="main"><div style="font-weight:620">${esc(e.name)}${e.overdue ? ' <span class="chip warn">overdue</span>' : ''}${e.type === 'income' ? ' <span class="chip info">expected</span>' : ''}</div>
      <div class="bal">Balance after: <span class="num">${fmt(e.after.expected)}</span>${e.savingsTaken ? ` · ${fmt(e.savingsTaken)} to savings` : ''}</div></div>
    <div class="num ${e.type === 'income' ? 'good' : ''}" style="font-weight:680">${e.type === 'income' ? '+' : ''}${fmt(e.amountCents)}</div></div>`).join('') || '<div class="muted">Nothing scheduled in the next 6 weeks.</div>'}</section>`;
  return h;
}

/* ====================================================================== */
/* CATEGORY DETAIL                                                        */
/* ====================================================================== */
export function categoryPage(id, mk) {
  const st = S(), t = today(), idx = categoryIndex(st);
  const isUncat = id === '_uncat';
  const c = isUncat ? { id: '_uncat', name: 'Uncategorized', icon: '❔', kind: 'variable' } : idx.byId.get(id);
  if (!c) return `<button class="back-btn" data-act="back">${icon('chevL')} Back</button><div class="empty">Category not found.</div>`;
  const root = isUncat ? c : idx.root(c.id);
  const m = computeMonth(st, mk, t);
  const line = m.lines.find(l => l.category.id === root.id);
  const subIds = new Set(isUncat ? [] : [c.id, ...(c.parentId ? [] : idx.children(c.id).map(x => x.id))]);
  const txs = st.transactions.filter(x => x.kind === 'expense' && monthKey(x.date) === mk &&
    (isUncat ? !x.categoryId || !idx.byId.has(x.categoryId) : subIds.has(x.categoryId)))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const spent = sum(txs, x => x.amountCents);
  let h = `<div class="topbar"><button class="back-btn" data-act="back">${icon('chevL')} Back</button>${monthNav(mk, 'catMonth')}</div>`;
  h += `<div style="display:flex;align-items:center;gap:12px;margin:0 2px 16px"><div class="ico" style="width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--card-3);font-size:26px">${esc(c.icon || '•')}</div>
    <div style="flex:1;min-width:0"><div style="font-size:24px;font-weight:740;letter-spacing:-.02em">${esc(c.name)}</div><div class="muted" style="font-size:13px">${c.parentId ? `Subcategory of ${esc(idx.byId.get(c.parentId)?.name || '')}` : { fixed: 'Fixed · bills & recurring', variable: 'Discretionary', savings: 'Savings' }[c.kind]}</div></div>
    ${isUncat ? '' : `<button class="icon-btn" data-act="editCategory" data-id="${c.id}" aria-label="Edit category">${icon('edit')}</button>`}</div>`;

  if (line && !c.parentId && line.kind === 'variable') {
    const tone = toneOf(line.status);
    h += `<section class="card"><div class="card-h"><h2>${fmtMonth(mk)}</h2>${m.phase === 'future' ? '' : pill(line.status)}</div>
      <div class="num" style="font-size:34px;font-weight:750;letter-spacing:-.03em">${fmt(line.spent)} <span class="muted" style="font-size:16px;font-weight:600">of ${fmt(line.budget)}</span></div>
      <div style="margin:12px 0 6px">${barHTML(line.usedShare, m.phase === 'current' ? m.elapsedShare : null, tone === 'muted' ? 'good' : tone, true)}</div>
      ${m.phase === 'current' ? `<div class="kv"><span class="k">Budget used</span><span class="v">${pctTxt(line.usedShare)} with ${pctTxt(m.elapsedShare)} of the month gone</span></div>
      <div class="kv"><span class="k">Left to spend</span><span class="v num ${line.remaining < 0 ? 'danger' : ''}">${fmt(line.remaining)}</span></div>
      <div class="kv"><span class="k">Per day for ${m.remainingDays} days</span><span class="v num">${fmt(line.dailyAllowance)}</span></div>
      <div class="kv"><span class="k">Projected month total</span><span class="v num ${line.projected > line.budget ? 'danger' : ''}">${fmt(line.projected)}</span></div>` : ''}
      <p class="explain">${categorySentence(line, m)}</p>
      <div class="btn-row" style="margin-top:12px"><button class="btn sm" data-act="editBudget" data-id="${c.id}" data-month="${mk}">${line.budget ? 'Change budget' : 'Set budget'}</button><button class="btn sm primary" data-act="addTx" data-cat="${c.id}">Add expense</button></div></section>`;
  } else if (line && line.kind === 'savings' && !c.parentId) {
    h += `<section class="card"><div class="num" style="font-size:30px;font-weight:750">${fmt(line.spent)} <span class="muted" style="font-size:15px">of ${fmt(line.budget)} planned</span></div>
      <div style="margin:12px 0">${barHTML(line.budget ? line.spent / line.budget : 0, null, 'good', true)}</div>
      <div class="btn-row"><button class="btn sm" data-act="editBudget" data-id="${c.id}" data-month="${mk}">Monthly savings target</button><button class="btn sm primary" data-act="addTx" data-kind="savings" data-cat="${c.id}">Move to savings</button></div></section>`;
  } else if (line && line.kind === 'fixed' && !c.parentId) {
    h += `<section class="card"><div class="kv"><span class="k">Paid this month</span><span class="v num">${fmt(line.spent)}</span></div><div class="kv"><span class="k">Still due</span><span class="v num">${fmt(line.committed)}</span></div><div class="kv total"><span class="k">Planned</span><span class="v num">${fmt(line.budget)}</span></div>
      ${line.bills.length ? `<div style="margin:6px -16px -16px">${line.bills.map(o => `<div class="row-item"><div class="main"><div class="title">${esc(o.name)}</div><div class="subt">${fmtDate(o.date)} · ${o.paid ? 'paid' : o.date < t ? 'overdue' : 'due'}</div></div><div class="amt num">${fmt(o.paid ? o.tx.amountCents : o.amountCents)}</div>${o.paid ? '' : `<button class="btn xs primary" data-act="payBill" data-bill="${o.billId}" data-date="${o.date}">Pay</button>`}</div>`).join('')}</div>` : ''}</section>`;
  } else {
    h += `<section class="card"><div class="num" style="font-size:30px;font-weight:750">${fmt(spent)}</div><div class="muted">spent in ${fmtMonth(mk)}</div></section>`;
  }

  // 6-month trend
  const series = [];
  for (let i = 5; i >= 0; i--) {
    const k = addMonths(mk, -i);
    const s = sum(st.transactions.filter(x => x.kind === 'expense' && monthKey(x.date) === k && (isUncat ? !x.categoryId : subIds.has(x.categoryId))), x => x.amountCents);
    series.push({ label: fmtMonthShort(k), values: [s], budget: isUncat || c.parentId ? 0 : budgetFor(st, root.id, k), k });
  }
  const selT = ui.chartSel.cattrend ?? null;
  h += `<section class="card"><div class="card-h"><h2>Last 6 months</h2></div>${bars({ chartId: 'cattrend', sel: selT, height: 150, groups: series, series: [{ name: 'Spent', color: c.color || '#2fd18b' }], line: series.some(x => x.budget) && c.kind === 'variable' ? { color: '#f5b84b', values: series.map(x => x.budget) } : null })}
    <div class="chart-tip">${selT !== null ? `<b>${fmtMonth(series[selT].k)}</b>: ${fmt(series[selT].values[0])}${series[selT].budget ? ` of ${fmt(series[selT].budget)} budget` : ''}` : (series.some(x => x.budget) && c.kind === 'variable' ? 'Dashed line = budget. Tap a month for details.' : 'Tap a month for details.')}</div></section>`;

  // subcategory split
  if (!c.parentId && !isUncat) {
    const subs = idx.children(c.id);
    if (subs.length) {
      h += `<div class="section-title">Subcategories</div><div class="list">${[{ id: c.id, name: `${c.name} (general)`, icon: c.icon }, ...subs].map(s => {
        const v = sum(txs.filter(x => x.categoryId === s.id), x => x.amountCents);
        return `<button class="row-item" data-act="${s.id === c.id ? 'noop' : 'openCategory'}" data-id="${s.id}"><div class="ico">${esc(s.icon || '•')}</div><div class="main"><div class="title">${esc(s.name)}</div></div><div class="amt num">${fmt(v)}</div></button>`;
      }).join('')}</div>`;
    }
    h += `<button class="btn block ghost" data-act="newCategory" data-parent="${c.id}" style="color:var(--green)">${icon('plus')} Add subcategory</button>`;
  }
  h += `<div class="section-title">Transactions · ${txs.length}</div>`;
  h += txs.length ? `<div class="list">${txs.map(x => txRow(x, idx)).join('')}</div>` : `<div class="card empty"><p>No transactions in ${fmtMonth(mk)}.</p></div>`;
  return h;
}

function categorySentence(l, m) {
  const n = l.category.name.toLowerCase();
  if (m.phase === 'future') return `Budget for ${fmtMonth(m.month)}: ${fmt(l.budget)}.`;
  if (l.budget === 0) return l.spent ? `You spent ${fmt(l.spent)} on ${n} without a budget. Set one so it's part of your plan.` : `No budget set for ${n}.`;
  if (m.phase === 'past') return l.spent > l.budget ? `You went ${fmt(l.spent - l.budget)} over on ${n}.` : `You finished ${fmt(l.budget - l.spent)} under budget on ${n}.`;
  if (l.status === 'over') return `You're ${fmt(l.spent - l.budget)} over your ${n} budget. Anything more here reduces what's left for other categories.`;
  if (l.status === 'fast') return `You've used ${pctTxt(l.usedShare)} of this budget with only ${pctTxt(m.elapsedShare)} of the month gone. At this pace you'll spend ${fmt(l.projected)} — ${fmt(l.projectedOver)} over. Keep it to ${fmt(l.dailyAllowance)} a day to finish on budget.`;
  if (l.status === 'ahead') return `You're under pace: ${fmt(l.expectedToDate - l.spent)} below where an even spend would put you. You can spend ${fmt(l.dailyAllowance)} a day and finish on budget.`;
  return `Right on pace. ${fmt(l.dailyAllowance)} a day keeps you on budget.`;
}

/* ====================================================================== */
/* ANALYTICS                                                              */
/* ====================================================================== */
export function analytics() {
  const st = S(), t = today(), mk = ui.month;
  let h = topbar('Analytics', fmtMonth(mk), monthNav(mk));
  const kinds = ui.anKind === 'variable' ? ['variable'] : ui.anKind === 'fixed' ? ['fixed'] : ['fixed', 'variable'];
  const br = categoryBreakdown(st, mk, { kinds });
  const total = sum(br, x => x.cents);
  // 1. spending by category
  h += `<section class="card"><div class="card-h"><h2>Spending by category</h2></div>
    <div class="toggle" style="margin-bottom:6px">${[['all', 'All'], ['variable', 'Discretionary'], ['fixed', 'Fixed']].map(([k, l]) => `<button class="${(ui.anKind || 'all') === k ? 'on' : ''}" data-act="anKind" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="donut-wrap">${donut(br.map(x => ({ value: x.cents, color: x.category.color || '#8d9ab2', id: x.category.id })), { month: mk })}
      <div class="center"><div class="v num">${fmt(total, { showCents: false })}</div><div class="l">${ui.anKind === 'variable' ? 'discretionary' : ui.anKind === 'fixed' ? 'fixed' : 'total spent'}</div></div></div>
    <div class="legend">${br.map(x => `<button data-act="openCategory" data-id="${x.category.id}" data-month="${mk}"><i class="dot" style="background:${x.category.color || '#8d9ab2'}"></i><span class="n">${esc(x.category.icon || '')} ${esc(x.category.name)}</span><span class="p">${total ? Math.round(x.cents / total * 100) : 0}%</span><span class="v num">${fmt(x.cents)}</span></button>`).join('') || '<div class="muted" style="text-align:center;padding:10px">No spending this month.</div>'}</div></section>`;

  // 2. budget vs actual
  const m = computeMonth(st, mk, t);
  const vl = m.lines.filter(l => l.kind === 'variable' && (l.budget || l.spent));
  h += `<section class="card"><div class="card-h"><h2>Budget vs. actual</h2><span class="muted num" style="font-size:13px">${fmt(m.variable.spent)} / ${fmt(m.variable.budget)}</span></div>
    <div class="hbar">${vl.map(l => `<div class="r tappable" data-act="openCategory" data-id="${l.category.id}" data-month="${mk}" style="cursor:pointer"><div class="top"><span class="n">${esc(l.category.icon || '')} ${esc(l.category.name)}</span><span class="num"><b class="${l.spent > l.budget ? 'danger' : ''}">${fmt(l.spent, { showCents: false })}</b> <span class="muted">/ ${fmt(l.budget, { showCents: false })}</span></span></div>${barHTML(l.usedShare, m.phase === 'current' ? m.elapsedShare : null, l.spent > l.budget ? 'danger' : l.status === 'fast' ? 'warn' : 'good')}</div>`).join('') || '<div class="muted">No budgets yet.</div>'}</div>
    ${m.phase === 'current' ? '<p class="explain">White tick = where an even pace would put you today.</p>' : ''}</section>`;

  // The 6 months ending at the selected month
  const six = [];
  for (let i = 5; i >= 0; i--) {
    const k = addMonths(mk, -i);
    const s = computeMonth(st, k, t);
    six.push({ k, label: fmtMonthShort(k), income: s.income.receivedCents, fixed: s.spending.fixedSpent, variable: s.spending.variableSpent, savings: s.spending.savingsDone, spent: s.spending.totalSpent, rate: s.savingsRate, phase: s.phase });
  }
  // 3. income vs expenses
  const selIE = ui.chartSel.ie ?? null;
  h += `<section class="card"><div class="card-h"><h2>Income vs. expenses</h2></div>
    ${bars({ chartId: 'ie', sel: selIE, groups: six.map(x => ({ label: x.label, values: [x.income, x.spent] })), series: [{ name: 'Income', color: '#2fd18b' }, { name: 'Expenses', color: '#ff8a7a' }] })}
    <div class="chart-keys"><span><i class="dot" style="background:#2fd18b"></i>Income received</span><span><i class="dot" style="background:#ff8a7a"></i>Spending (excl. savings)</span></div>
    <div class="chart-tip">${selIE !== null ? (() => { const x = six[selIE]; return `<b>${fmtMonth(x.k)}</b>: in ${fmt(x.income)}, out ${fmt(x.spent)} → <b class="${x.income - x.spent < 0 ? 'danger' : 'good'}">${fmt(x.income - x.spent, { sign: true })}</b>`; })() : 'Tap a month for details.'}</div></section>`;

  // 4. fixed vs variable
  const selFV = ui.chartSel.fv ?? null;
  const cur = six[5];
  h += `<section class="card"><div class="card-h"><h2>Fixed vs. variable</h2></div>
    ${bars({ chartId: 'fv', sel: selFV, mode: 'stacked', groups: six.map(x => ({ label: x.label, values: [x.fixed, x.variable, x.savings] })), series: [{ name: 'Fixed', color: '#7c9cff' }, { name: 'Variable', color: '#fb923c' }, { name: 'Savings', color: '#2fd18b' }] })}
    <div class="chart-keys"><span><i class="dot" style="background:#7c9cff"></i>Fixed</span><span><i class="dot" style="background:#fb923c"></i>Variable</span><span><i class="dot" style="background:#2fd18b"></i>Saved</span></div>
    <div class="chart-tip">${(() => { const x = six[selFV ?? 5]; const tot = x.fixed + x.variable; return `<b>${fmtMonth(x.k)}</b>: fixed ${fmt(x.fixed)} (${tot ? Math.round(x.fixed / tot * 100) : 0}%), variable ${fmt(x.variable)} (${tot ? Math.round(x.variable / tot * 100) : 0}%), saved ${fmt(x.savings)}`; })()}</div></section>`;

  // 5. month over month
  const prev = six[4];
  const change = prev.spent ? (cur.spent - prev.spent) / prev.spent : null;
  const selMM = ui.chartSel.mm ?? null;
  h += `<section class="card"><div class="card-h"><h2>Month-over-month spending</h2>${change !== null ? `<span class="chip ${change > 0.05 ? 'warn' : change < -0.05 ? 'good' : ''}">${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% vs ${prev.label}</span>` : ''}</div>
    ${lines({ chartId: 'mm', sel: selMM, labelEvery: 1, labels: six.map(x => x.label), series: [{ name: 'Spent', color: '#fb923c', values: six.map(x => x.spent), fill: true }, { name: 'Variable', color: '#a78bfa', values: six.map(x => x.variable), dash: '4 3', width: 1.6 }] })}
    <div class="chart-keys"><span><i class="dot" style="background:#fb923c"></i>Total spending</span><span><i class="dot" style="background:#a78bfa"></i>Discretionary only</span></div>
    <div class="chart-tip">${selMM !== null ? `<b>${fmtMonth(six[selMM].k)}</b>: total ${fmt(six[selMM].spent)}, discretionary ${fmt(six[selMM].variable)}` : cur.phase === 'current' ? `${fmtMonthShort(cur.k)} is still in progress (${m.dayOfMonth} of ${m.dim} days).` : 'Tap a month for details.'}</div></section>`;

  // 6. savings rate
  const rates = six.map(x => (x.rate === null ? 0 : Math.round(x.rate * 1000)));
  const valid = six.filter(x => x.rate !== null && x.phase === 'past');
  const avg = valid.length ? valid.reduce((a, x) => a + x.rate, 0) / valid.length : null;
  const selSR = ui.chartSel.sr ?? null;
  h += `<section class="card"><div class="card-h"><h2>Savings rate</h2>${avg !== null ? `<span class="chip ${avg >= 0.2 ? 'good' : avg >= 0.1 ? '' : 'warn'}">avg ${Math.round(avg * 100)}%</span>` : ''}</div>
    ${bars({ chartId: 'sr', sel: selSR, height: 150, fmtY: v => `${Math.round(v / 10)}%`, groups: six.map((x, i) => ({ label: x.label, values: [Math.max(0, rates[i])] })), series: [{ name: 'Rate', color: '#2fd18b' }] })}
    <div class="chart-tip">${(() => { const x = six[selSR ?? 5]; return x.rate === null ? `<b>${fmtMonth(x.k)}</b>: no income recorded.` : `<b>${fmtMonth(x.k)}</b>: you kept <b>${Math.round(x.rate * 100)}%</b> of take-home (${fmt(x.income - x.spent)} of ${fmt(x.income)}).`; })()}</div>
    <p class="explain">Savings rate = share of take-home pay you didn't spend. 20%+ is a strong target.</p></section>`;
  return h;
}

/* ====================================================================== */
/* SETTINGS                                                               */
/* ====================================================================== */
export function settings() {
  const st = S(), t = today(), idx = categoryIndex(st);
  const s = st.settings;
  const bal = computeMonth(st, monthKey(t), t).cash?.balanceNow ?? null;
  let h = topbar('Settings');
  // account
  const cloudy = store.mode === 'cloud';
  h += `<div class="section-title">Account & sync</div><div class="list">
    <div class="row-item"><div class="ico">${cloudy ? '☁️' : '📱'}</div><div class="main"><div class="title">${cloudy ? esc(store.user.email) : 'This device only'}</div>
      <div class="subt">${cloudy ? `${syncDot()} ${esc(syncText())}` : 'Data is stored on this iPhone. Sign in to back up & sync.'}</div></div>
      ${cloudy ? `<button class="btn xs" data-act="syncNow">${icon('sync')} Sync</button>` : `<button class="btn xs primary" data-act="signInSheet">Sign in</button>`}</div>
    ${store.sync.setupRequired ? `<div class="row-item"><div class="banner warn" style="margin:0">Cloud tables aren't set up yet. Run <b>budget/supabase/schema.sql</b> in your Supabase SQL editor, then tap Sync. Your data is safe on this device meanwhile.</div></div>` : ''}
    ${cloudy ? `<button class="row-item" data-act="changePassword"><div class="ico">🔑</div><div class="main"><div class="title">Change password</div></div><span class="chev">${icon('chevR')}</span></button>` : ''}
    <button class="row-item" data-act="signOut"><div class="ico">↩︎</div><div class="main"><div class="title">${cloudy ? 'Sign out' : 'Switch account / sign out'}</div><div class="subt">${cloudy ? 'A copy stays cached for offline use' : 'Device data is kept'}</div></div></button></div>`;
  // money
  h += `<div class="section-title">Your money</div><div class="list">
    <button class="row-item" data-act="editBalance"><div class="ico">🏦</div><div class="main"><div class="title">Checking balance</div><div class="subt">${s.balanceDate ? `You set ${fmt(s.balanceCents)} on ${fmtDate(s.balanceDate)}${s.demoBalance ? ' (sample)' : ''}` : 'Not set'}</div></div><div class="amt num">${bal !== null ? fmt(bal) : '—'}<small>${bal !== null ? 'now' : ''}</small></div><span class="chev">${icon('chevR')}</span></button>
    <button class="row-item" data-act="editBuffer"><div class="ico">🛟</div><div class="main"><div class="title">Safety buffer</div><div class="subt">Kept aside, never counted as spendable</div></div><div class="amt num">${fmt(s.bufferCents || 0)}</div><span class="chev">${icon('chevR')}</span></button>
    <button class="row-item" data-act="openSeg" data-seg="income"><div class="ico">💼</div><div class="main"><div class="title">Income & paydays</div><div class="subt">${st.incomeSources.length} source${st.incomeSources.length === 1 ? '' : 's'}</div></div><span class="chev">${icon('chevR')}</span></button>
    <button class="row-item" data-act="openSeg" data-seg="bills"><div class="ico">🧾</div><div class="main"><div class="title">Recurring bills</div><div class="subt">${st.bills.length} bill${st.bills.length === 1 ? '' : 's'}</div></div><span class="chev">${icon('chevR')}</span></button>
    <button class="row-item" data-act="openSeg" data-seg="goals"><div class="ico">🎯</div><div class="main"><div class="title">Savings goals</div><div class="subt">${st.goals.length} goal${st.goals.length === 1 ? '' : 's'}</div></div><span class="chev">${icon('chevR')}</span></button></div>`;
  // categories
  const kinds = [['variable', 'Discretionary'], ['fixed', 'Fixed'], ['savings', 'Savings']];
  h += `<div class="section-title">Categories</div><div class="list">${kinds.map(([k, label]) => {
    const roots = idx.roots.filter(c => c.kind === k);
    return roots.map(c => `<button class="row-item" data-act="editCategory" data-id="${c.id}" style="${c.archived ? 'opacity:.5' : ''}"><div class="ico">${esc(c.icon || '•')}</div><div class="main"><div class="title">${esc(c.name)}</div><div class="subt">${label}${idx.children(c.id).length ? ` · ${idx.children(c.id).map(x => esc(x.name)).join(', ')}` : ''}${c.archived ? ' · hidden' : ''}</div></div><span class="dot" style="background:${c.color || '#8d9ab2'}"></span><span class="chev">${icon('chevR')}</span></button>`).join('');
  }).join('')}<button class="row-item" data-act="newCategory" style="color:var(--green);font-weight:600"><div class="ico">${icon('plus')}</div><div class="main">New category</div></button></div>`;
  // data
  h += `<div class="section-title">Data</div><div class="list">
    <button class="row-item" data-act="exportCsv"><div class="ico">${icon('download')}</div><div class="main"><div class="title">Export transactions (CSV)</div><div class="subt">Opens in Numbers, Excel, Google Sheets</div></div></button>
    <button class="row-item" data-act="exportSummary"><div class="ico">📊</div><div class="main"><div class="title">Export monthly summary (CSV)</div><div class="subt">Budget vs actual for every month</div></div></button>
    <button class="row-item" data-act="backup"><div class="ico">💾</div><div class="main"><div class="title">Full backup (JSON)</div><div class="subt">Everything — restore it on any device</div></div></button>
    <button class="row-item" data-act="restore"><div class="ico">♻️</div><div class="main"><div class="title">Restore from backup</div></div></button>
    <button class="row-item" data-act="importCsv"><div class="ico">📥</div><div class="main"><div class="title">Import transactions (CSV)</div><div class="subt">date, amount, category, merchant, notes</div></div></button></div>`;
  h += `<div class="section-title">Sample data</div><div class="list">
    ${store.hasDemo() ? `<button class="row-item" data-act="removeDemo"><div class="ico">🧹</div><div class="main"><div class="title danger">Remove sample data</div><div class="subt">Deletes only sample rows — anything you added stays</div></div></button>`
      : `<button class="row-item" data-act="loadDemo"><div class="ico">🧪</div><div class="main"><div class="title">Load sample data</div><div class="subt">3 months of realistic, clearly-tagged demo entries</div></div></button>`}</div>`;
  h += `<div class="section-title">Install</div><div class="card"><div style="font-weight:650;margin-bottom:6px">Add to your iPhone home screen</div><div class="muted" style="font-size:13.5px;line-height:1.55">Open this page in Safari → tap <b>Share</b> → <b>Add to Home Screen</b>. It launches full-screen like a native app and works offline.</div></div>`;
  h += `<div class="list"><button class="row-item" data-act="wipe"><div class="ico">⚠️</div><div class="main"><div class="title danger">Erase all data</div><div class="subt">${cloudy ? 'Deletes everything in this account' : 'Deletes everything on this device'}</div></div></button></div>`;
  h += `<p class="dim" style="text-align:center;font-size:12px;margin-top:18px">Runway · amounts stored in cents · ${st.transactions.length} transactions</p>`;
  return h;
}

function syncText() {
  const s = store.sync;
  if (s.status === 'syncing') return 'Syncing…';
  if (s.status === 'synced') return `Synced${s.lastSync ? ` ${new Date(s.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}${store.outbox.length ? ` · ${store.outbox.length} pending` : ''}`;
  if (s.status === 'offline') return `Offline · ${store.outbox.length} change${store.outbox.length === 1 ? '' : 's'} waiting`;
  if (s.status === 'error') return `Sync problem: ${s.error}`;
  return 'Ready';
}
