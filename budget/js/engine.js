/* engine.js — the budgeting engine. Pure functions, no DOM, no storage.
   Every figure the UI shows comes from here, so all screens agree.

   Core money distinctions this engine keeps separate:
     • income RECEIVED (confirmed transactions)   vs  income EXPECTED (schedule, not yet confirmed)
     • FIXED (bills / recurring)                  vs  VARIABLE (discretionary categories)
     • money already SPENT                        vs  money COMMITTED to unpaid bills / savings
     • monthly BUDGET (your plan)                 vs  ACTUAL spending
     • SAFE TO SPEND (cash- and budget-limited)   vs  total income

   State shape (all money in integer cents):
     settings      { balanceCents, balanceDate, balanceSetAt, bufferCents }
     categories    [{ id, name, parentId, kind: 'fixed'|'variable'|'savings', icon, color, archived }]
     budgets       [{ id, categoryId, month:'YYYY-MM', amountCents, scope:'from'|'only', updatedAt }]
     incomeSources [{ id, name, kind, amountCents, <rule fields>, active }]
     bills         [{ id, name, categoryId, amountCents, <rule fields>, autopay, active }]
     transactions  [{ id, kind:'expense'|'income', date, amountCents, categoryId, merchant, notes,
                      billId, billDate, incomeSourceId, incomeDate, goalId, createdAt }]
     goals         [{ id, name, kind:'target'|'monthly', targetCents, startingCents, targetDate }]   */

import { occurrences, perYear } from './schedule.js';
import {
  toDayNum, fromDayNum, addDays, diffDays, monthKey, monthStart, monthEnd, daysInMonthKey,
  dayOf, addMonths, fmtDate,
} from './dates.js';
import { sum, divFloor, divCeil, fmt } from './money.js';

/* ---------------- Tunables ---------------- */
export const PACE = {
  fastRatio: 1.10,     // spending >10% ahead of the calendar = "spending fast"
  aheadRatio: 0.85,    // spending >15% behind the calendar = "ahead of budget"
  minGapShare: 0.03,   // ignore pace gaps smaller than 3% of the budget (early-month noise)
};

/* ---------------- Category helpers ---------------- */
export function categoryIndex(state) {
  const byId = new Map(state.categories.map(c => [c.id, c]));
  const rootCache = new Map();
  const root = id => {
    if (!id) return null;
    if (rootCache.has(id)) return rootCache.get(id);
    let c = byId.get(id), guard = 0;
    while (c && c.parentId && byId.has(c.parentId) && guard++ < 10) c = byId.get(c.parentId);
    const r = c || null;
    rootCache.set(id, r);
    return r;
  };
  const kindOf = id => (root(id)?.kind) || 'variable';
  const roots = state.categories.filter(c => !c.parentId || !byId.has(c.parentId));
  const children = pid => state.categories.filter(c => c.parentId === pid);
  return { byId, root, kindOf, roots, children };
}

/** Budget for a category in a month. An 'only' entry for that exact month wins;
    otherwise the most recent 'from' entry at or before the month applies. */
export function budgetFor(state, categoryId, month) {
  let only = null, from = null;
  for (const b of state.budgets) {
    if (b.categoryId !== categoryId) continue;
    if (b.scope === 'only') { if (b.month === month) only = b; continue; }
    if (b.month <= month && (!from || b.month > from.month ||
      (b.month === from.month && (b.updatedAt || '') > (from.updatedAt || '')))) from = b;
  }
  if (only) return only.amountCents;
  return from ? from.amountCents : 0;
}

/* ---------------- Schedules ---------------- */

/** Income occurrences in [from,to] with their received status. */
export function incomeOccurrences(state, from, to) {
  const out = [];
  const received = new Map();
  for (const t of state.transactions) {
    if (t.kind === 'income' && t.incomeSourceId && t.incomeDate) received.set(`${t.incomeSourceId}|${t.incomeDate}`, t);
  }
  for (const s of state.incomeSources) {
    if (s.active === false) continue;
    for (const date of occurrences(s, from, to)) {
      const tx = received.get(`${s.id}|${date}`) || null;
      out.push({ type: 'income', sourceId: s.id, source: s, name: s.name, date, expectedCents: s.amountCents, tx, received: !!tx });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Bill occurrences in [from,to] with their paid status. */
export function billOccurrences(state, from, to) {
  const out = [];
  const paid = new Map();
  for (const t of state.transactions) {
    if (t.kind === 'expense' && t.billId && t.billDate) paid.set(`${t.billId}|${t.billDate}`, t);
  }
  for (const b of state.bills) {
    if (b.active === false) continue;
    for (const date of occurrences(b, from, to)) {
      const tx = paid.get(`${b.id}|${date}`) || null;
      out.push({ type: 'bill', billId: b.id, bill: b, name: b.name, categoryId: b.categoryId, date, amountCents: b.amountCents, tx, paid: !!tx });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ---------------- Actual balance ---------------- */

/** Does this transaction post after the balance anchor? (It is NOT yet reflected in the
    balance the user typed in.) Same-day transactions count only if entered afterwards. */
function afterAnchor(t, s) {
  if (t.date > s.balanceDate) return true;
  if (t.date < s.balanceDate) return false;
  return (t.createdAt || '') > (s.balanceSetAt || '');
}

/** Confirmed checking balance as of `asOf` — only actual, recorded money. Never expected income. */
export function actualBalance(state, asOf) {
  const s = state.settings || {};
  if (s.balanceCents === null || s.balanceCents === undefined || !s.balanceDate) return null;
  let bal = s.balanceCents;
  for (const t of state.transactions) {
    if (t.date > asOf || !afterAnchor(t, s)) continue;
    bal += t.kind === 'income' ? t.amountCents : -t.amountCents;
  }
  return bal;
}

/* ---------------- Pace / status ---------------- */

export const STATUS = {
  ahead: { label: 'AHEAD', tone: 'good' },
  on_track: { label: 'ON TRACK', tone: 'good' },
  fast: { label: 'SPENDING FAST', tone: 'warn' },
  over: { label: 'OVER BUDGET', tone: 'danger' },
  under: { label: 'UNDER BUDGET', tone: 'good' },
  idle: { label: 'NOT STARTED', tone: 'muted' },
  funded: { label: 'FUNDED', tone: 'good' },
  pending: { label: 'TO DO', tone: 'muted' },
  short: { label: 'SHORT', tone: 'warn' },
};

/** Evaluate spending pace for one budget line. */
export function evaluatePace({ budget, spent, dayOfMonth, dim, phase }) {
  const elapsed = dim ? dayOfMonth / dim : 0;
  const expectedToDate = Math.round(budget * elapsed);
  const projected = phase === 'current' && dayOfMonth > 0
    ? spent + Math.round((spent / dayOfMonth) * (dim - dayOfMonth))
    : spent;
  let status;
  if (spent > budget) status = 'over';
  else if (phase === 'past') status = 'under';
  else if (phase === 'future') status = 'idle';
  else if (budget === 0) status = 'on_track';
  else {
    const ratio = expectedToDate > 0 ? spent / expectedToDate : (spent > 0 ? Infinity : 1);
    const gap = Math.abs(spent - expectedToDate);
    if (ratio > PACE.fastRatio && gap > budget * PACE.minGapShare) status = 'fast';
    else if (ratio < PACE.aheadRatio && gap > budget * PACE.minGapShare) status = 'ahead';
    else status = 'on_track';
  }
  return {
    budget, spent, remaining: budget - spent, expectedToDate, projected,
    projectedOver: Math.max(0, projected - budget),
    usedShare: budget > 0 ? spent / budget : (spent > 0 ? Infinity : 0),
    elapsedShare: elapsed, status,
  };
}

/* ---------------- Month snapshot ---------------- */

/**
 * Full picture of one month as of `today`.
 * phase: 'past' (month over), 'current' (today inside it), 'future'.
 */
export function computeMonth(state, mk, today) {
  const start = monthStart(mk), end = monthEnd(mk), dim = daysInMonthKey(mk);
  const phase = end < today ? 'past' : start > today ? 'future' : 'current';
  const dayOfMonth = phase === 'current' ? dayOf(today) : phase === 'past' ? dim : 0;
  const remainingDays = phase === 'current' ? dim - dayOfMonth + 1 : phase === 'future' ? dim : 0; // incl. today
  const idx = categoryIndex(state);
  const s = state.settings || {};
  const buffer = Math.max(0, s.bufferCents || 0);

  const txM = state.transactions.filter(t => t.date >= start && t.date <= end);
  const expenses = txM.filter(t => t.kind === 'expense');
  const incomeTx = txM.filter(t => t.kind === 'income');

  /* ---- income ---- */
  const incOcc = incomeOccurrences(state, start, end);
  const receivedCents = sum(incomeTx, t => t.amountCents);
  const unreceived = incOcc.filter(o => !o.received);
  const pendingUpcoming = phase === 'past' ? [] : unreceived.filter(o => o.date >= today);
  const pendingOverdue = phase === 'current' ? unreceived.filter(o => o.date < today) : [];
  const pendingCents = sum([...pendingUpcoming, ...pendingOverdue], o => o.expectedCents);
  const expectedCents = receivedCents + (phase === 'past' ? 0 : pendingCents);
  const scheduledCents = sum(incOcc, o => o.expectedCents); // pure plan, ignoring actuals

  /* ---- spending by kind ---- */
  const byKind = { fixed: 0, variable: 0, savings: 0 };
  const byRoot = new Map();
  for (const t of expenses) {
    const r = idx.root(t.categoryId);
    const kind = r?.kind || 'variable';
    byKind[kind] += t.amountCents;
    const key = r?.id || '_uncat';
    byRoot.set(key, (byRoot.get(key) || 0) + t.amountCents);
  }

  /* ---- bills ---- */
  const billOcc = billOccurrences(state, start, end);
  const unpaidBills = billOcc.filter(o => !o.paid);
  const committedBills = phase === 'past' ? [] : unpaidBills; // includes overdue (still owed)
  const overdueBills = phase === 'current' ? unpaidBills.filter(o => o.date < today) : [];
  const committedBillsCents = sum(committedBills, o => o.amountCents);
  const fixedPlannedCents = sum(billOcc, o => o.amountCents);

  /* ---- category lines ---- */
  const lines = [];
  for (const c of idx.roots) {
    if (c.archived && !byRoot.get(c.id)) continue;
    const spent = byRoot.get(c.id) || 0;
    let budget;
    if (c.kind === 'fixed') {
      const occ = billOcc.filter(o => idx.root(o.categoryId)?.id === c.id);
      const explicit = budgetFor(state, c.id, mk);
      // Planned = scheduled bills (paid at actual amount) + any explicit extra budget
      budget = sum(occ, o => (o.tx ? o.tx.amountCents : o.amountCents)) + explicit;
      const unpaid = phase === 'past' ? 0 : sum(occ.filter(o => !o.paid), o => o.amountCents);
      lines.push({
        category: c, kind: 'fixed', budget, spent, committed: unpaid,
        remaining: budget - spent - unpaid,
        status: spent + unpaid > budget ? 'over' : (phase === 'past' ? 'under' : 'on_track'),
        bills: occ,
      });
      continue;
    }
    budget = budgetFor(state, c.id, mk);
    if (c.kind === 'savings') {
      // Saving more than planned is good; saving less is only a concern once pay has run out.
      lines.push({ category: c, kind: 'savings', budget, spent, remaining: budget - spent,
        usedShare: budget > 0 ? spent / budget : 0, elapsedShare: dim ? dayOfMonth / dim : 0,
        status: spent >= budget ? 'funded' : (phase === 'past' ? 'short' : 'pending'), dailyAllowance: 0 });
      continue;
    }
    const pace = evaluatePace({ budget, spent, dayOfMonth, dim, phase });
    const dailyAllowance = phase === 'past' ? 0 : divFloor(Math.max(0, budget - spent), remainingDays);
    lines.push({ category: c, kind: c.kind, ...pace, dailyAllowance });
  }
  if (byRoot.get('_uncat')) {
    const spent = byRoot.get('_uncat');
    lines.push({ category: { id: '_uncat', name: 'Uncategorized', icon: '❔', kind: 'variable', color: '#8a97ad' },
      kind: 'variable', ...evaluatePace({ budget: 0, spent, dayOfMonth, dim, phase }), dailyAllowance: 0 });
  }

  const varLines = lines.filter(l => l.kind === 'variable');
  const savLines = lines.filter(l => l.kind === 'savings');
  const variableBudget = sum(varLines, l => l.budget);
  const variableSpent = byKind.variable;
  const variable = evaluatePace({ budget: variableBudget, spent: variableSpent, dayOfMonth, dim, phase });

  const savingsPlan = sum(savLines, l => l.budget);
  const savingsDone = byKind.savings;
  const savingsRemaining = phase === 'past' ? 0 : Math.max(0, savingsPlan - savingsDone);

  /* ---- cash position (current month only) ---- */
  const balanceNow = phase === 'current' ? actualBalance(state, today) : null;
  const hasBalance = balanceNow !== null;
  const budgetRemaining = Math.max(0, variableBudget - variableSpent);

  let cash = null;
  if (phase === 'current' && hasBalance) {
    // Everything we can count on through month end — expected pay included, but labeled as such.
    const monthCapacity = balanceNow + pendingCents - committedBillsCents - savingsRemaining - buffer;
    const safeMonth = Math.max(0, Math.min(budgetRemaining, monthCapacity));
    const limitedBy = monthCapacity < budgetRemaining ? 'cash' : 'budget';

    // Until next paycheck: confirmed money only.
    const pay = nextPayday(state, today);
    let untilPay = null;
    if (pay) {
      // Unpaid bills from the start of this month (overdue still counts) up to the day before payday.
      const billsBefore = pay.date > start ? billOccurrences(state, start, addDays(pay.date, -1)).filter(o => !o.paid) : [];
      const owed = sum(billsBefore, o => o.amountCents);
      const days = Math.max(1, diffDays(today, pay.date)); // days to spend before pay arrives (incl. today)
      const free = balanceNow - owed - buffer;
      untilPay = {
        payday: pay, days, billsDue: billsBefore, billsDueCents: owed, freeCents: free,
        perDay: divFloor(Math.max(0, free), days), shortfall: free < 0 ? -free : 0,
      };
    }
    const perDayMonth = divFloor(safeMonth, remainingDays);
    const perDay = untilPay ? Math.min(perDayMonth, untilPay.perDay) : perDayMonth;
    // Next 7 days (or to month end): days before payday are held to the cash-only limit.
    let perWeek = 0;
    for (let i = 0; i < Math.min(7, remainingDays); i++) {
      perWeek += untilPay && i < untilPay.days ? perDay : perDayMonth;
    }
    perWeek = Math.min(safeMonth, perWeek);
    cash = {
      balanceNow, monthCapacity, safeMonth, limitedBy, perDay, perDayMonth, perWeek, untilPay,
      tightBeforePayday: !!(untilPay && untilPay.perDay < perDayMonth),
    };
  }

  /* ---- projections ---- */
  let projection = null;
  if (phase === 'current') {
    const fixedRemainder = committedBillsCents;
    const pacedVariableRest = Math.max(0, variable.projected - variableSpent);
    const plannedVariableRest = budgetRemaining;
    const totalSpendPace = byKind.fixed + fixedRemainder + variable.projected;
    projection = {
      variableAtPace: variable.projected,
      totalSpendAtPace: totalSpendPace,
      endBalanceAtPace: hasBalance ? balanceNow + pendingCents - fixedRemainder - savingsRemaining - pacedVariableRest : null,
      endBalanceOnBudget: hasBalance ? balanceNow + pendingCents - fixedRemainder - savingsRemaining - plannedVariableRest : null,
      endBalanceConfirmedOnly: hasBalance ? balanceNow - fixedRemainder - savingsRemaining - pacedVariableRest : null,
    };
  }

  /* ---- plan check (zero-based) ---- */
  const planIncome = phase === 'past' ? receivedCents : Math.max(expectedCents, scheduledCents);
  const unallocated = planIncome - fixedPlannedCents - savingsPlan - variableBudget;

  const totalSpent = byKind.fixed + byKind.variable; // savings transfers are not spending
  const savingsRate = receivedCents > 0 ? (receivedCents - totalSpent) / receivedCents : null;

  /* ---- overall status ---- */
  let status = variable.status;
  let statusReason = 'pace';
  if (phase === 'current' && cash) {
    if (cash.monthCapacity < 0 || (cash.untilPay && cash.untilPay.shortfall > 0)) { status = 'over'; statusReason = 'cash'; }
  }
  if (phase === 'current' && variableBudget === 0 && variableSpent === 0 && statusReason !== 'cash') status = 'idle';

  const snap = {
    month: mk, today, phase, dim, dayOfMonth, remainingDays, elapsedShare: dim ? dayOfMonth / dim : 0,
    income: {
      receivedCents, expectedCents, pendingCents, scheduledCents,
      occurrences: incOcc, pendingUpcoming, pendingOverdue, transactions: incomeTx,
    },
    spending: { totalSpent, fixedSpent: byKind.fixed, variableSpent, savingsDone, expenses },
    bills: { occurrences: billOcc, unpaid: unpaidBills, overdue: overdueBills, committedCents: committedBillsCents, plannedCents: fixedPlannedCents },
    variable: { ...variable, budget: variableBudget, budgetRemaining },
    savings: { plan: savingsPlan, done: savingsDone, remaining: savingsRemaining },
    lines, cash, projection, unallocated, planIncome, savingsRate, status, statusReason, buffer,
    plannedSpend: fixedPlannedCents + variableBudget,
  };
  snap.insights = buildInsights(snap);
  return snap;
}

/* ---------------- Paydays & cash flow ---------------- */

/** The next expected paycheck on or after today that hasn't been confirmed. */
export function nextPayday(state, today, horizon = 70) {
  const occ = incomeOccurrences(state, today, addDays(today, horizon)).filter(o => !o.received);
  const pay = occ.find(o => (o.source.kind || 'paycheck') === 'paycheck') || occ[0];
  return pay || null;
}

/**
 * Day-by-day projected balance from today. Three lines:
 *   confirmed — actual balance minus unpaid bills (no expected income at all)
 *   expected  — plus expected income on its scheduled dates
 *   planned   — plus spending your remaining variable budget evenly
 */
export function cashFlow(state, today, days = 42) {
  const bal = actualBalance(state, today);
  const to = addDays(today, days - 1);
  const look = monthStart(monthKey(today)); // overdue items from this month are still pending/owed
  const inc = incomeOccurrences(state, look, to).filter(o => !o.received);
  const bills = billOccurrences(state, look, to).filter(o => !o.paid);
  const buffer = state.settings?.bufferCents || 0;

  // Daily variable allowance per month (remaining budget spread over remaining days).
  const allowance = new Map();
  const allowanceFor = d => {
    const mk = monthKey(d);
    if (!allowance.has(mk)) {
      const snap = computeMonth(state, mk, today);
      const rem = mk === monthKey(today) ? snap.variable.budgetRemaining : snap.variable.budget;
      allowance.set(mk, divFloor(rem, snap.remainingDays || 1));
    }
    return allowance.get(mk);
  };
  // Savings still planned this month go out with this month's remaining paychecks; with
  // no paycheck left this month they come out of today's balance.
  const cur = computeMonth(state, monthKey(today), today);
  let savingsLeft = cur.savings.remaining;
  const curMonth = monthKey(today);

  const events = [];
  for (const o of inc) events.push({ date: o.date < today ? today : o.date, origDate: o.date, type: 'income', name: o.name, amountCents: o.expectedCents, overdue: o.date < today, ref: o });
  for (const o of bills) events.push({ date: o.date < today ? today : o.date, origDate: o.date, type: 'bill', name: o.name, amountCents: -o.amountCents, overdue: o.date < today, ref: o });
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === 'income' ? -1 : 1));
  const monthIncome = events.filter(e => e.type === 'income' && monthKey(e.date) === curMonth);
  const lastMonthIncome = monthIncome[monthIncome.length - 1] || null;
  let upfrontSavings = monthIncome.length ? 0 : savingsLeft;
  if (upfrontSavings) savingsLeft = 0;

  const series = [];
  if (bal === null) return { hasBalance: false, series, events, buffer };
  let confirmed = bal, expected = bal - upfrontSavings, planned = bal - upfrontSavings;
  let low = { planned: Infinity, date: null }, firstShort = null, firstBelowBuffer = null;
  let ei = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const dayEvents = [];
    while (ei < events.length && events[ei].date === d) dayEvents.push(events[ei++]);
    for (const e of dayEvents) {
      if (e.type === 'bill') { confirmed += e.amountCents; expected += e.amountCents; planned += e.amountCents; }
      else {
        expected += e.amountCents; planned += e.amountCents;
        if (savingsLeft > 0 && monthKey(d) === curMonth) {
          // The month's last paycheck covers whatever savings are still outstanding.
          const take = e === lastMonthIncome ? savingsLeft : Math.min(savingsLeft, e.amountCents);
          savingsLeft -= take; expected -= take; planned -= take;
          e.savingsTaken = take;
        }
      }
    }
    const spend = allowanceFor(d);
    planned -= spend;
    series.push({ date: d, confirmed, expected, planned, events: dayEvents, spend });
    if (planned < low.planned) low = { planned, date: d };
    if (firstShort === null && planned < 0) firstShort = d;
    if (firstBelowBuffer === null && planned < buffer) firstBelowBuffer = d;
  }
  const pay = nextPayday(state, today);
  let lowBeforePay = null;
  if (pay) {
    for (const p of series) {
      if (p.date >= pay.date) break;
      if (!lowBeforePay || p.planned < lowBeforePay.planned) lowBeforePay = p;
    }
  }
  return { hasBalance: true, start: bal, upfrontSavings, series, events, low, firstShort, firstBelowBuffer, buffer, payday: pay, lowBeforePay };
}

/* ---------------- Income projection ---------------- */

export function incomeSummary(state, today) {
  const mk = monthKey(today);
  const year = today.slice(0, 4);
  const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
  const next12End = addDays(today, 364);
  const sources = state.incomeSources.filter(s => s.active !== false).map(s => {
    const thisMonth = occurrences(s, monthStart(mk), monthEnd(mk));
    const yearOcc = occurrences(s, yStart, yEnd);
    const next12 = occurrences(s, today, next12End);
    const py = perYear(s);
    return {
      source: s,
      perPaycheck: s.amountCents,
      thisMonthCount: thisMonth.length, thisMonthCents: thisMonth.length * s.amountCents,
      yearCount: yearOcc.length, yearCents: yearOcc.length * s.amountCents,
      next12Count: next12.length, next12Cents: next12.length * s.amountCents,
      monthlyAvgCents: s.frequency === 'once' ? 0 : Math.round(s.amountCents * py / 12),
      next: next12[0] || null,
    };
  });
  return {
    sources,
    thisMonthCents: sum(sources, x => x.thisMonthCents),
    yearCents: sum(sources, x => x.yearCents),
    next12Cents: sum(sources, x => x.next12Cents),
    monthlyAvgCents: sum(sources, x => x.monthlyAvgCents),
    year,
  };
}

/** Monthly-equivalent cost of a bill (for planning: annual bills spread across 12 months). */
export function monthlyEquivalent(rule) {
  if (rule.frequency === 'once') return 0;
  return Math.round(rule.amountCents * perYear(rule) / 12);
}

/* ---------------- Goals ---------------- */

export function goalProgress(state, goal, today) {
  const contributions = state.transactions.filter(t => t.goalId === goal.id && t.kind === 'expense');
  const contributed = sum(contributions, t => t.amountCents);
  const mk = monthKey(today);
  if (goal.kind === 'monthly') {
    // "Save $X a month" counts every transfer into a savings category this month.
    const idx = categoryIndex(state);
    const thisMonth = sum(state.transactions.filter(t => t.kind === 'expense' && monthKey(t.date) === mk &&
      (t.goalId === goal.id || idx.kindOf(t.categoryId) === 'savings')), t => t.amountCents);
    const target = goal.targetCents || 0;
    return {
      goal, kind: 'monthly', saved: thisMonth, target, remaining: Math.max(0, target - thisMonth),
      share: target > 0 ? Math.min(1, thisMonth / target) : 0, done: thisMonth >= target,
      perPaycheck: null, perMonth: target, paychecksLeft: null,
    };
  }
  const saved = (goal.startingCents || 0) + contributed;
  const target = goal.targetCents || 0;
  const remaining = Math.max(0, target - saved);
  let paychecksLeft = null, perPaycheck = null, perMonth = null, monthsLeft = null;
  if (goal.targetDate && goal.targetDate > today) {
    const pays = state.incomeSources.filter(s => s.active !== false && (s.kind || 'paycheck') === 'paycheck');
    const set = new Set();
    for (const s of pays) for (const d of occurrences(s, addDays(today, 1), goal.targetDate)) set.add(d);
    // A paycheck today that hasn't been confirmed yet still counts.
    for (const o of incomeOccurrences(state, today, today)) if (!o.received && (o.source.kind || 'paycheck') === 'paycheck') set.add(o.date);
    paychecksLeft = set.size;
    perPaycheck = paychecksLeft > 0 ? divCeil(remaining, paychecksLeft) : remaining;
    monthsLeft = Math.max(1, diffMonthsInclusive(today, goal.targetDate));
    perMonth = divCeil(remaining, monthsLeft);
  }
  // Recent pace: average monthly contribution over the last 3 full months + this month.
  const since = monthStart(addMonths(mk, -3));
  const recent = sum(contributions.filter(t => t.date >= since), t => t.amountCents);
  const monthsObserved = 3 + dayOf(today) / daysInMonthKey(mk);
  const pacePerMonth = Math.round(recent / monthsObserved);
  let eta = null;
  if (remaining === 0) eta = today;
  else if (pacePerMonth > 0) eta = addDays(today, Math.ceil(remaining / pacePerMonth * 30.436875));
  const onTrack = goal.targetDate ? (eta ? eta <= goal.targetDate : false) : null;
  return {
    goal, kind: 'target', saved, target, remaining, share: target > 0 ? Math.min(1, saved / target) : 0,
    done: target > 0 && saved >= target, paychecksLeft, perPaycheck, perMonth, monthsLeft, pacePerMonth, eta, onTrack,
  };
}

/** Months touched from a's month through b's month, counting the current month as one. */
function diffMonthsInclusive(a, b) {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am) + 1;
}

/* ---------------- History / analytics ---------------- */

export function monthSeries(state, today, count = 6) {
  const cur = monthKey(today);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const mk = addMonths(cur, -i);
    const s = computeMonth(state, mk, today);
    out.push({
      month: mk, phase: s.phase,
      income: s.income.receivedCents, fixed: s.spending.fixedSpent, variable: s.spending.variableSpent,
      savings: s.spending.savingsDone, spent: s.spending.totalSpent,
      variableBudget: s.variable.budget, savingsRate: s.savingsRate,
    });
  }
  return out;
}

/** Spending per root category (and subcategory) for a month. */
export function categoryBreakdown(state, mk, { kinds = ['fixed', 'variable'] } = {}) {
  const idx = categoryIndex(state);
  const start = monthStart(mk), end = monthEnd(mk);
  const map = new Map();
  for (const t of state.transactions) {
    if (t.kind !== 'expense' || t.date < start || t.date > end) continue;
    const r = idx.root(t.categoryId);
    const kind = r?.kind || 'variable';
    if (!kinds.includes(kind)) continue;
    const key = r?.id || '_uncat';
    if (!map.has(key)) map.set(key, { category: r || { id: '_uncat', name: 'Uncategorized', icon: '❔', color: '#8a97ad', kind: 'variable' }, cents: 0, count: 0, subs: new Map() });
    const e = map.get(key);
    e.cents += t.amountCents; e.count++;
    const sub = t.categoryId && t.categoryId !== key ? idx.byId.get(t.categoryId) : null;
    const sk = sub ? sub.id : '_self';
    e.subs.set(sk, (e.subs.get(sk) || 0) + t.amountCents);
  }
  return [...map.values()].filter(e => e.cents !== 0).sort((a, b) => b.cents - a.cents);
}

/* ---------------- Plain-language insights ---------------- */

const pctStr = x => `${Math.round(x * 100)}%`;

export function buildInsights(snap) {
  const out = [];
  const { phase } = snap;
  if (phase === 'future') return out;

  if (phase === 'current' && snap.cash?.untilPay?.shortfall > 0) {
    const u = snap.cash.untilPay;
    out.push({ level: 'danger', key: 'shortfall', title: `You may run short before payday`,
      body: `Bills due before ${fmtDate(u.payday.date)} total ${fmt(u.billsDueCents)}, which leaves you ${fmt(u.shortfall)} short of your balance${snap.buffer ? ' plus safety buffer' : ''}. Hold off on non-essential spending or move money in.` });
  } else if (phase === 'current' && snap.cash && snap.cash.monthCapacity < 0) {
    out.push({ level: 'danger', key: 'cash', title: `Cash won't cover this month's commitments`,
      body: `Even with expected pay, upcoming bills and savings exceed what you'll have by ${fmt(-snap.cash.monthCapacity)}. Consider reducing this month's savings transfer or pausing discretionary spending.` });
  }

  for (const o of snap.bills.overdue) {
    out.push({ level: 'warn', key: `overdue-${o.billId}-${o.date}`, title: `${o.name} was due ${fmtDate(o.date)}`,
      body: `Not marked paid yet. It's still counted as money you owe (${fmt(o.amountCents)}).`, action: { type: 'payBill', billId: o.billId, date: o.date } });
  }
  for (const o of snap.income.pendingOverdue) {
    out.push({ level: 'info', key: `unconfirmed-${o.sourceId}-${o.date}`, title: `Did your ${o.name} arrive?`,
      body: `Expected ${fmtDate(o.date)} (${fmt(o.expectedCents)}). Until you confirm it, it isn't counted in your actual balance.`, action: { type: 'receiveIncome', sourceId: o.sourceId, date: o.date } });
  }

  const lines = snap.lines.filter(l => l.kind === 'variable');
  for (const l of lines) {
    const name = l.category.name;
    if (l.status === 'over') {
      out.push({ level: 'danger', key: `over-${l.category.id}`, categoryId: l.category.id,
        title: l.budget > 0 ? `${name} is over budget` : `Unbudgeted spending in ${name}`,
        body: l.budget > 0
          ? `You've spent ${fmt(l.spent)} of ${fmt(l.budget)} — ${fmt(l.spent - l.budget)} over.${phase === 'current' ? ' Any more here comes out of other categories.' : ''}`
          : `${fmt(l.spent)} spent with no budget set. Give it a budget so it's planned for.` });
    } else if (phase === 'current' && l.status === 'fast') {
      out.push({ level: 'warn', key: `fast-${l.category.id}`, categoryId: l.category.id,
        title: `${name}: spending too quickly`,
        body: `You've used ${pctStr(l.usedShare)} of your ${name.toLowerCase()} budget but only ${pctStr(l.elapsedShare)} of the month has passed. At this pace you'll spend ${fmt(l.projected)} (budget ${fmt(l.budget)}). Keep it to ${fmt(l.dailyAllowance)}/day to finish on budget.` });
    }
  }

  if (phase === 'current') {
    const v = snap.variable;
    if (v.status === 'ahead' && v.budget > 0) {
      out.push({ level: 'good', key: 'ahead', title: `You're ahead of budget`,
        body: `${pctStr(v.elapsedShare)} of the month is gone and you've used ${pctStr(v.usedShare)} of your discretionary budget — ${fmt(v.expectedToDate - v.spent)} below plan.` });
    } else if (v.status === 'on_track' && v.budget > 0 && v.spent > 0) {
      out.push({ level: 'good', key: 'ontrack', title: `Spending is on pace`,
        body: `You've used ${pctStr(v.usedShare)} of your discretionary budget with ${pctStr(v.elapsedShare)} of the month gone.` });
    }
    if (snap.cash?.tightBeforePayday && !(snap.cash.untilPay.shortfall > 0)) {
      const u = snap.cash.untilPay;
      out.push({ level: 'warn', key: 'tight', title: `Tight until ${fmtDate(u.payday.date)}`,
        body: `Your budget allows ${fmt(snap.cash.perDayMonth)}/day, but after bills due before payday you only have ${fmt(Math.max(0, u.freeCents))} free for ${u.days} day${u.days === 1 ? '' : 's'} — about ${fmt(u.perDay)}/day until your paycheck.` });
    }
    if (snap.projection && snap.projection.endBalanceAtPace !== null && snap.projection.endBalanceAtPace < 0) {
      out.push({ level: 'danger', key: 'negend', title: `On pace to end the month negative`,
        body: `If you keep spending like this, your balance would be ${fmt(snap.projection.endBalanceAtPace)} on ${fmtDate(monthEnd(snap.month))}.` });
    }
    if (snap.savings.plan > 0 && snap.savings.remaining > 0 && snap.income.pendingUpcoming.length === 0 && snap.remainingDays <= 7) {
      out.push({ level: 'warn', key: 'savings', title: `Savings goal not funded yet`,
        body: `${fmt(snap.savings.remaining)} of your ${fmt(snap.savings.plan)} monthly savings hasn't been moved, and no more paychecks are expected this month.` });
    }
    if (snap.unallocated < 0) {
      out.push({ level: 'warn', key: 'plan', title: `Your plan exceeds your income`,
        body: `Bills, savings and budgets add up to ${fmt(-snap.unallocated)} more than this month's expected take-home. Trim a budget or lower savings.` });
    }
  }
  const order = { danger: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Plain-language one-liner for the dashboard hero. */
export function headline(snap) {
  if (snap.phase !== 'current') return '';
  const c = snap.cash;
  if (!c) return 'Set your current account balance to see what you can safely spend.';
  if (snap.status === 'over' && snap.statusReason === 'cash') return 'Your upcoming bills need more than you have. Pause discretionary spending.';
  if (snap.status === 'over') return `You've spent more than your discretionary budget this month.`;
  if (snap.status === 'fast') return `You're spending faster than planned. Ease off to about ${fmt(c.perDay)}/day.`;
  if (snap.status === 'ahead') return `You're under pace — nice. You can spend up to ${fmt(c.perDay)} today and stay on plan.`;
  if (snap.status === 'idle') return 'Set budgets for your spending categories to start tracking pace.';
  return `You're on track. Spend up to ${fmt(c.perDay)} a day and you'll finish on budget.`;
}

export { monthKey, addMonths, toDayNum, fromDayNum };
