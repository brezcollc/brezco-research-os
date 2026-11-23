// Run: node --test budget/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, fmt, toDecimal, divFloor } from '../js/money.js';
import { daysInMonth, weekday, addDays, diffDays } from '../js/dates.js';
import { occurrences } from '../js/schedule.js';
import {
  computeMonth, actualBalance, budgetFor, incomeSummary, goalProgress, cashFlow, evaluatePace, monthSeries,
} from '../js/engine.js';

/* ---------- helpers ---------- */
let seq = 0;
const id = p => `${p}${++seq}`;
const C = (name, kind, extra = {}) => ({ id: name.toLowerCase().replace(/\W/g, ''), name, kind, parentId: null, ...extra });
const tx = (date, cents, categoryId, extra = {}) => ({ id: id('t'), kind: 'expense', date, amountCents: cents, categoryId, createdAt: `${date}T12:00:00Z`, ...extra });
const pay = (date, cents, sourceId = 'job') => ({ id: id('t'), kind: 'income', date, amountCents: cents, incomeSourceId: sourceId, incomeDate: date, createdAt: `${date}T09:00:00Z` });
const budget = (categoryId, month, cents, scope = 'from') => ({ id: id('b'), categoryId, month, amountCents: cents, scope });

function baseState(overrides = {}) {
  return {
    settings: { balanceCents: 300000, balanceDate: '2026-10-31', balanceSetAt: '2026-10-31T23:00:00Z', bufferCents: 0 },
    categories: [
      C('Housing', 'fixed'), C('Phone', 'fixed'),
      C('Groceries', 'variable'), C('Restaurants', 'variable'), C('Shopping', 'variable'),
      C('Savings', 'savings'),
      { id: 'coffee', name: 'Coffee', parentId: 'restaurants', kind: 'variable' },
    ],
    budgets: [budget('groceries', '2026-01', 60000), budget('restaurants', '2026-01', 40000), budget('savings', '2026-01', 50000)],
    incomeSources: [{ id: 'job', name: 'Paycheck', kind: 'paycheck', amountCents: 200000, frequency: 'biweekly', anchorDate: '2026-11-06' }],
    bills: [
      { id: 'rent', name: 'Rent', categoryId: 'housing', amountCents: 150000, frequency: 'monthly', anchorDate: '2026-01-01', dayOfMonth: 1 },
      { id: 'phone', name: 'Phone', categoryId: 'phone', amountCents: 8000, frequency: 'monthly', anchorDate: '2026-01-20', dayOfMonth: 20 },
    ],
    transactions: [],
    goals: [],
    ...overrides,
  };
}

/* ---------- money ---------- */
test('money: parsing is exact in cents', () => {
  assert.equal(parseMoney('0.29'), 29);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('1.005'), 101);
  assert.equal(parseMoney('(4.00)'), -400);
  assert.equal(parseMoney('-3.99'), -399);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('0.10') + parseMoney('0.20'), 30); // no 0.30000000000000004
  let total = 0; for (let i = 0; i < 1000; i++) total += parseMoney('0.01');
  assert.equal(total, 1000);
  assert.equal(fmt(123456), '$1,234.56');
  assert.equal(fmt(-5), '−$0.05');
  assert.equal(toDecimal(-123405), '-1234.05');
  assert.equal(divFloor(10000, 3), 3333);
});

/* ---------- calendar ---------- */
test('dates: month lengths incl. leap years', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(weekday('2026-11-22'), 0); // Sunday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2028-02-28', '2028-03-01'), 2);
});

/* ---------- schedules ---------- */
test('schedule: biweekly paychecks produce 3-paycheck months', () => {
  const r = { frequency: 'biweekly', anchorDate: '2026-01-02' };
  assert.deepEqual(occurrences(r, '2026-01-01', '2026-01-31'), ['2026-01-02', '2026-01-16', '2026-01-30']);
  assert.equal(occurrences(r, '2026-02-01', '2026-02-28').length, 2);
  assert.equal(occurrences(r, '2026-01-01', '2026-12-31').length, 26);
  // The anchor is any known payday: the schedule extends backwards from it…
  assert.deepEqual(occurrences(r, '2025-12-01', '2025-12-31'), ['2025-12-05', '2025-12-19']);
  // …unless a start date bounds it
  assert.deepEqual(occurrences({ ...r, startDate: '2026-01-01' }, '2025-12-01', '2025-12-31'), []);
  // Entering the NEXT payday still finds earlier paydays this month
  assert.deepEqual(occurrences({ frequency: 'biweekly', anchorDate: '2026-12-04' }, '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-20']);
});

test('schedule: monthly bill on the 31st clamps to short months', () => {
  const r = { frequency: 'monthly', anchorDate: '2026-01-31', dayOfMonth: 31 };
  assert.deepEqual(occurrences(r, '2026-02-01', '2026-02-28'), ['2026-02-28']);
  assert.deepEqual(occurrences(r, '2028-02-01', '2028-02-29'), ['2028-02-29']);
  assert.deepEqual(occurrences(r, '2026-04-01', '2026-04-30'), ['2026-04-30']);
  assert.deepEqual(occurrences(r, '2026-05-01', '2026-05-31'), ['2026-05-31']);
});

test('schedule: semimonthly with weekend adjustment', () => {
  const r = { frequency: 'semimonthly', anchorDate: '2026-01-01', semimonthlyDays: [15, 31], weekendAdjust: 'before' };
  // Nov 15 2026 is a Sunday -> Friday Nov 13; Nov 30 is a Monday
  assert.deepEqual(occurrences(r, '2026-11-01', '2026-11-30'), ['2026-11-13', '2026-11-30']);
  // Feb 2026: 15th is Sunday -> 13th; last day 28th is Saturday -> 27th
  assert.deepEqual(occurrences(r, '2026-02-01', '2026-02-28'), ['2026-02-13', '2026-02-27']);
  // Adjusted date that crosses back into the previous month is still found
  const r2 = { frequency: 'monthly', anchorDate: '2026-01-01', dayOfMonth: 1, weekendAdjust: 'before' };
  // Aug 1 2026 is a Saturday -> Jul 31
  assert.ok(occurrences(r2, '2026-07-01', '2026-07-31').includes('2026-07-31'));
});

test('schedule: quarterly, annual (Feb 29), weekly, custom, once, end date', () => {
  assert.deepEqual(occurrences({ frequency: 'quarterly', anchorDate: '2026-01-15' }, '2026-01-01', '2026-12-31'),
    ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
  assert.deepEqual(occurrences({ frequency: 'annually', anchorDate: '2024-02-29' }, '2025-01-01', '2028-12-31'),
    ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.equal(occurrences({ frequency: 'weekly', anchorDate: '2026-11-06' }, '2026-11-01', '2026-11-30').length, 4);
  assert.deepEqual(occurrences({ frequency: 'custom', intervalDays: 10, anchorDate: '2026-11-01' }, '2026-11-01', '2026-11-30'),
    ['2026-11-01', '2026-11-11', '2026-11-21']);
  assert.deepEqual(occurrences({ frequency: 'once', anchorDate: '2026-12-15' }, '2026-12-01', '2026-12-31'), ['2026-12-15']);
  assert.deepEqual(occurrences({ frequency: 'weekly', anchorDate: '2026-11-06', endDate: '2026-11-15' }, '2026-11-01', '2026-11-30'),
    ['2026-11-06', '2026-11-13']);
});

/* ---------- budgets history ---------- */
test('budgets: from-month changes and one-month overrides', () => {
  const s = baseState({ budgets: [budget('x', '2026-09', 30000), budget('x', '2026-11', 40000), budget('x', '2026-10', 25000, 'only')] });
  assert.equal(budgetFor(s, 'x', '2026-08'), 0);
  assert.equal(budgetFor(s, 'x', '2026-09'), 30000);
  assert.equal(budgetFor(s, 'x', '2026-10'), 25000);
  assert.equal(budgetFor(s, 'x', '2026-11'), 40000);
  assert.equal(budgetFor(s, 'x', '2027-03'), 40000);
});

/* ---------- Scenario A: mid-month, on track, biweekly pay ---------- */
test('scenario A: on-track mid-month with biweekly pay, rent paid, phone pending', () => {
  const s = baseState();
  s.transactions = [
    tx('2026-11-01', 150000, 'housing', { billId: 'rent', billDate: '2026-11-01' }),
    pay('2026-11-06', 200000),
    tx('2026-11-03', 10000, 'restaurants'), tx('2026-11-10', 10000, 'coffee'), // subcategory rolls up
    tx('2026-11-08', 30000, 'groceries'),
  ];
  const m = computeMonth(s, '2026-11', '2026-11-15');
  assert.equal(m.phase, 'current');
  assert.equal(m.dim, 30);
  assert.equal(m.remainingDays, 16);
  assert.equal(m.income.receivedCents, 200000);
  assert.equal(m.income.pendingCents, 200000);          // Nov 20 paycheck
  assert.equal(m.income.expectedCents, 400000);
  assert.equal(m.bills.committedCents, 8000);           // phone, not yet paid
  assert.equal(m.spending.fixedSpent, 150000);
  assert.equal(m.spending.variableSpent, 50000);
  assert.equal(m.variable.budget, 100000);
  assert.equal(m.variable.status, 'on_track');          // 50% used, 50% elapsed
  assert.equal(m.savings.remaining, 50000);
  assert.equal(m.cash.balanceNow, 300000);              // 3000 + 2000 - 1500 - 500
  assert.equal(m.cash.monthCapacity, 300000 + 200000 - 8000 - 50000);
  assert.equal(m.cash.safeMonth, 50000);                // limited by remaining budget
  assert.equal(m.cash.limitedBy, 'budget');
  assert.equal(m.cash.perDay, 3125);                    // $500 / 16 days
  assert.equal(m.cash.untilPay.payday.date, '2026-11-20');
  assert.equal(m.cash.untilPay.days, 5);
  assert.equal(m.projection.variableAtPace, 100000);
  assert.equal(m.projection.endBalanceAtPace, 300000 + 200000 - 8000 - 50000 - 50000);
  assert.equal(m.status, 'on_track');
  const restaurants = m.lines.find(l => l.category.id === 'restaurants');
  assert.equal(restaurants.spent, 20000);
  assert.equal(restaurants.dailyAllowance, 1250);       // $200 left / 16 days
});

/* ---------- Scenario B: spending too fast (70% used at 40% of month) ---------- */
test('scenario B: restaurant budget 70% used with 40% of month gone is flagged', () => {
  const s = baseState();
  s.transactions = [tx('2026-11-05', 28000, 'restaurants'), pay('2026-11-06', 200000)];
  const m = computeMonth(s, '2026-11', '2026-11-12');
  const r = m.lines.find(l => l.category.id === 'restaurants');
  assert.equal(r.status, 'fast');
  assert.equal(Math.round(r.usedShare * 100), 70);
  assert.equal(Math.round(r.elapsedShare * 100), 40);
  assert.equal(r.projected, 70000);                     // 280 + 280/12*18
  const ins = m.insights.find(i => i.key === 'fast-restaurants');
  assert.ok(ins, 'insight present');
  assert.match(ins.body, /70%/);
  assert.match(ins.body, /40%/);
  const g = m.lines.find(l => l.category.id === 'groceries');
  assert.equal(g.status, 'ahead');                      // nothing spent at 40%
});

/* ---------- Scenario C: overspending ---------- */
test('scenario C: category and overall overspending', () => {
  const s = baseState();
  s.transactions = [pay('2026-11-06', 200000), tx('2026-11-07', 45000, 'restaurants'), tx('2026-11-09', 70000, 'groceries')];
  const m = computeMonth(s, '2026-11', '2026-11-20');
  assert.equal(m.lines.find(l => l.category.id === 'restaurants').status, 'over');
  assert.equal(m.variable.status, 'over');
  assert.equal(m.status, 'over');
  assert.equal(m.cash.safeMonth, 0);
  assert.equal(m.cash.perDay, 0);
  assert.ok(m.insights.some(i => i.key === 'over-restaurants' && /\$50\.00 over/.test(i.body)));
  // Unbudgeted category spend is "over" too
  s.transactions.push(tx('2026-11-10', 5000, 'shopping'));
  const m2 = computeMonth(s, '2026-11', '2026-11-20');
  assert.equal(m2.lines.find(l => l.category.id === 'shopping').status, 'over');
});

/* ---------- Scenario D: short before payday ---------- */
test('scenario D: rent due before payday exceeds balance -> shortfall', () => {
  const s = baseState({ settings: { balanceCents: 50000, balanceDate: '2026-11-01', balanceSetAt: '2026-11-01T08:00:00Z', bufferCents: 10000 } });
  const m = computeMonth(s, '2026-11', '2026-11-03');
  assert.equal(m.bills.overdue.length, 1);              // rent due Nov 1, unpaid
  assert.equal(m.cash.untilPay.payday.date, '2026-11-06');
  assert.equal(m.cash.untilPay.billsDueCents, 150000);
  assert.equal(m.cash.untilPay.shortfall, 150000 + 10000 - 50000);
  assert.equal(m.status, 'over');
  assert.equal(m.statusReason, 'cash');
  assert.equal(m.cash.perDay, 0);
  assert.equal(m.insights[0].key, 'shortfall');
});

/* ---------- Scenario E: months of different lengths ---------- */
test('scenario E: pace and daily allowance across 28/29/30/31-day months', () => {
  const s = baseState({ budgets: [budget('groceries', '2020-01', 28000)], incomeSources: [], bills: [],
    settings: { balanceCents: 1000000, balanceDate: '2020-01-01', balanceSetAt: '2020-01-01T00:00:00Z', bufferCents: 0 } });
  // Feb 2026: 28 days, day 14 = 50%
  s.transactions = [tx('2026-02-10', 14000, 'groceries')];
  let m = computeMonth(s, '2026-02', '2026-02-14');
  assert.equal(m.dim, 28); assert.equal(m.remainingDays, 15);
  assert.equal(m.variable.status, 'on_track');
  assert.equal(m.cash.perDay, divFloor(14000, 15));
  // Feb 2028: leap year, 29 days
  s.transactions = [tx('2028-02-10', 14000, 'groceries')];
  m = computeMonth(s, '2028-02', '2028-02-14');
  assert.equal(m.dim, 29); assert.equal(m.remainingDays, 16);
  assert.equal(m.cash.perDay, divFloor(14000, 16));
  // 31-day month, last day: whole remaining budget is today's allowance
  s.transactions = [tx('2027-01-05', 20000, 'groceries')];
  m = computeMonth(s, '2027-01', '2027-01-31');
  assert.equal(m.dim, 31); assert.equal(m.remainingDays, 1);
  assert.equal(m.cash.perDay, 8000);
  // First day of a 30-day month: allowance spread over all 30 days
  s.transactions = [];
  m = computeMonth(s, '2026-11', '2026-11-01');
  assert.equal(m.remainingDays, 30);
  assert.equal(m.cash.perDay, divFloor(28000, 30));
});

/* ---------- received vs expected ---------- */
test('expected income is never counted in the actual balance', () => {
  const s = baseState();
  // Nov 6 payday passed but not confirmed
  const m = computeMonth(s, '2026-11', '2026-11-08');
  assert.equal(m.income.receivedCents, 0);
  assert.equal(m.income.pendingOverdue.length, 1);
  assert.equal(m.cash.balanceNow, 300000);              // unchanged by expected pay
  assert.ok(m.insights.some(i => i.key.startsWith('unconfirmed-job')));
  // Confirming it moves it into the balance
  s.transactions.push(pay('2026-11-06', 199500));        // actual amount differed slightly
  const m2 = computeMonth(s, '2026-11', '2026-11-08');
  assert.equal(m2.cash.balanceNow, 300000 + 199500);
  assert.equal(m2.income.receivedCents, 199500);
  assert.equal(m2.income.pendingOverdue.length, 0);
});

test('biweekly: a three-paycheck month is projected correctly', () => {
  const s = baseState({ incomeSources: [{ id: 'job', name: 'Paycheck', kind: 'paycheck', amountCents: 245000, frequency: 'biweekly', anchorDate: '2026-01-02' }] });
  const jan = incomeSummary(s, '2026-01-10');
  assert.equal(jan.sources[0].thisMonthCount, 3);
  assert.equal(jan.thisMonthCents, 735000);
  assert.equal(jan.yearCents, 26 * 245000);
  assert.equal(jan.monthlyAvgCents, Math.round(245000 * 26.08875 / 12));
  const feb = computeMonth(s, '2026-02', '2026-02-01');
  assert.equal(feb.income.scheduledCents, 490000);
});

test('balance anchor: same-day transactions count only if entered after the balance', () => {
  const s = baseState({ settings: { balanceCents: 100000, balanceDate: '2026-11-10', balanceSetAt: '2026-11-10T15:00:00Z' } });
  s.transactions = [
    { ...tx('2026-11-10', 1000, 'groceries'), createdAt: '2026-11-10T14:00:00Z' }, // already in balance
    { ...tx('2026-11-10', 2000, 'groceries'), createdAt: '2026-11-10T16:00:00Z' }, // after
    { ...tx('2026-11-09', 4000, 'groceries'), createdAt: '2026-11-12T10:00:00Z' }, // backfilled, already in balance
    tx('2026-11-11', 500, 'groceries'),
  ];
  assert.equal(actualBalance(s, '2026-11-12'), 100000 - 2000 - 500);
});

test('savings transfers are not spending but reduce cash', () => {
  const s = baseState();
  s.transactions = [pay('2026-11-06', 200000), tx('2026-11-06', 50000, 'savings')];
  const m = computeMonth(s, '2026-11', '2026-11-10');
  assert.equal(m.spending.totalSpent, 0);
  assert.equal(m.savings.done, 50000);
  assert.equal(m.savings.remaining, 0);
  assert.equal(m.cash.balanceNow, 300000 + 200000 - 50000);
});

test('bills paid at a different amount use the actual amount', () => {
  const s = baseState();
  s.transactions = [tx('2026-11-20', 9234, 'phone', { billId: 'phone', billDate: '2026-11-20' })];
  const m = computeMonth(s, '2026-11', '2026-11-21');
  const phone = m.lines.find(l => l.category.id === 'phone');
  assert.equal(phone.spent, 9234);
  assert.equal(phone.committed, 0);
  assert.equal(phone.budget, 9234);
  assert.equal(m.bills.committedCents, 150000);         // rent is still unpaid
});

/* ---------- goals ---------- */
test('goals: per-paycheck amount to reach a target by a date', () => {
  const s = baseState();
  s.goals = [{ id: 'g1', name: 'Emergency fund', kind: 'target', targetCents: 500000, startingCents: 100000, targetDate: '2027-02-28' }];
  s.transactions = [tx('2026-11-06', 50000, 'savings', { goalId: 'g1' })];
  const g = goalProgress(s, s.goals[0], '2026-11-10');
  assert.equal(g.saved, 150000);
  assert.equal(g.remaining, 350000);
  // Paychecks after Nov 10 through Feb 28: Nov 20, Dec 4, Dec 18, Jan 1, Jan 15, Jan 29, Feb 12, Feb 26 = 8
  assert.equal(g.paychecksLeft, 8);
  assert.equal(g.perPaycheck, 43750);
  assert.equal(g.monthsLeft, 4);
  assert.equal(g.perMonth, 87500);
});

/* ---------- pace edge cases ---------- */
test('pace: tolerance band avoids early-month noise', () => {
  // Day 1 of 30, $40 of $1,200 budget: ratio 1.0 → on track
  assert.equal(evaluatePace({ budget: 120000, spent: 4000, dayOfMonth: 1, dim: 30, phase: 'current' }).status, 'on_track');
  // Small absolute gap under 3% of budget is not "fast"
  assert.equal(evaluatePace({ budget: 120000, spent: 7000, dayOfMonth: 1, dim: 30, phase: 'current' }).status, 'on_track');
  assert.equal(evaluatePace({ budget: 120000, spent: 12000, dayOfMonth: 1, dim: 30, phase: 'current' }).status, 'fast');
  assert.equal(evaluatePace({ budget: 120000, spent: 120001, dayOfMonth: 20, dim: 30, phase: 'current' }).status, 'over');
  assert.equal(evaluatePace({ budget: 120000, spent: 100000, dayOfMonth: 30, dim: 30, phase: 'past' }).status, 'under');
});

/* ---------- cash flow ---------- */
test('cash flow: projected low point and confirmed-only line', () => {
  const s = baseState({ settings: { balanceCents: 160000, balanceDate: '2026-11-15', balanceSetAt: '2026-11-15T08:00:00Z', bufferCents: 0 } });
  s.transactions = [tx('2026-11-01', 150000, 'housing', { billId: 'rent', billDate: '2026-11-01' }), pay('2026-11-06', 200000)];
  const cf = cashFlow(s, '2026-11-15', 30);
  assert.equal(cf.series[0].date, '2026-11-15');
  const d20 = cf.series.find(p => p.date === '2026-11-20');
  assert.equal(d20.confirmed, 160000 - 8000);           // phone bill, no income in the confirmed line
  assert.ok(d20.expected > d20.confirmed);               // expected pay lands on the 20th
  const dec1 = cf.series.find(p => p.date === '2026-12-01');
  assert.equal(dec1.confirmed, 160000 - 8000 - 150000);  // December rent
  assert.equal(cf.payday.date, '2026-11-20');
  assert.ok(cf.lowBeforePay.planned < 160000);
});

test('history: past months report actuals and savings rate', () => {
  const s = baseState();
  s.transactions = [pay('2026-10-09', 200000), pay('2026-10-23', 200000), tx('2026-10-01', 150000, 'housing'), tx('2026-10-12', 50000, 'groceries')];
  const series = monthSeries(s, '2026-11-15', 2);
  assert.equal(series[0].month, '2026-10');
  assert.equal(series[0].income, 400000);
  assert.equal(series[0].spent, 200000);
  assert.equal(series[0].savingsRate, 0.5);
  const oct = computeMonth(s, '2026-10', '2026-11-15');
  assert.equal(oct.phase, 'past');
  assert.equal(oct.cash, null);
  assert.equal(oct.bills.committedCents, 0);            // past months don't create commitments
});

/* ---------- regressions found in review ---------- */
test('a cash shortfall is not hidden by the "no budgets yet" state', () => {
  const s = baseState({ budgets: [], settings: { balanceCents: 50000, balanceDate: '2026-11-01', balanceSetAt: '2026-11-01T08:00:00Z', bufferCents: 0 } });
  const m = computeMonth(s, '2026-11', '2026-11-03');
  assert.equal(m.status, 'over');
  assert.equal(m.statusReason, 'cash');
});

test('"this week" respects the cash-only limit before payday', () => {
  // $600 balance, rent paid, phone ($80) due before the Nov 20 payday, big budget remaining.
  const s = baseState({ settings: { balanceCents: 60000, balanceDate: '2026-11-15', balanceSetAt: '2026-11-15T08:00:00Z', bufferCents: 0 },
    budgets: [budget('groceries', '2026-01', 200000)] });
  s.bills[1] = { ...s.bills[1], dayOfMonth: 17 };
  s.transactions = [tx('2026-11-01', 150000, 'housing', { billId: 'rent', billDate: '2026-11-01' }), pay('2026-11-06', 200000)];
  const m = computeMonth(s, '2026-11', '2026-11-15');
  const u = m.cash.untilPay;
  assert.equal(u.days, 5);
  assert.equal(u.perDay, divFloor(60000 - 8000, 5));
  // 5 days at the cash limit + 2 days at the month rate
  assert.equal(m.cash.perWeek, Math.min(m.cash.safeMonth, u.perDay * 5 + m.cash.perDayMonth * 2));
  assert.ok(m.cash.perWeek < m.cash.perDayMonth * 7);
});

test('cash flow: savings with no paycheck left this month are deducted once and stay deducted', () => {
  const s = baseState({ settings: { balanceCents: 500000, balanceDate: '2026-11-21', balanceSetAt: '2026-11-21T08:00:00Z', bufferCents: 0 },
    incomeSources: [{ id: 'job', name: 'Paycheck', kind: 'paycheck', amountCents: 200000, frequency: 'monthly', anchorDate: '2026-01-01', dayOfMonth: 1 }],
    bills: [] , budgets: [budget('savings', '2026-01', 50000)] });
  s.transactions = [pay('2026-11-01', 200000)];
  const cf = cashFlow(s, '2026-11-25', 20);
  assert.equal(cf.upfrontSavings, 50000);
  const nov30 = cf.series.find(p => p.date === '2026-11-30');
  const dec2 = cf.series.find(p => p.date === '2026-12-02');
  assert.equal(nov30.expected, 450000);
  assert.equal(dec2.expected, 450000 + 200000); // Dec 1 paycheck added; savings NOT given back
});

test('cash flow: the last paycheck of the month covers all remaining savings', () => {
  const s = baseState({ settings: { balanceCents: 100000, balanceDate: '2026-11-15', balanceSetAt: '2026-11-15T08:00:00Z', bufferCents: 0 },
    bills: [], budgets: [budget('savings', '2026-01', 50000)] });
  s.incomeSources[0].amountCents = 30000; // paycheck smaller than the savings target
  s.transactions = [pay('2026-11-06', 30000)];
  const cf = cashFlow(s, '2026-11-15', 10);
  const nov20 = cf.series.find(p => p.date === '2026-11-20');
  assert.equal(nov20.expected, 100000 + 30000 - 50000);
});

/* ---------- savings-first features ---------- */
import { savingProjection, sweepAmount } from '../js/engine.js';

test('pay-yourself-first transfers count as savings, not bills or spending', () => {
  const s = baseState({ budgets: [budget('groceries', '2026-01', 60000), budget('restaurants', '2026-01', 40000)] });
  // $250 to savings every payday (biweekly, same schedule as the paycheck)
  s.bills.push({ id: 'xfer', name: 'Brokerage', categoryId: 'savings', amountCents: 25000, frequency: 'biweekly', anchorDate: '2026-11-06' });
  s.transactions = [tx('2026-11-01', 150000, 'housing', { billId: 'rent', billDate: '2026-11-01' }), pay('2026-11-06', 200000),
    tx('2026-11-06', 25000, 'savings', { billId: 'xfer', billDate: '2026-11-06' })];
  const m = computeMonth(s, '2026-11', '2026-11-15');
  assert.equal(m.bills.committedCents, 8000);           // only the phone bill
  assert.equal(m.bills.plannedCents, 158000);           // rent + phone, no transfers
  assert.equal(m.savings.plan, 50000);                  // 2 transfers scheduled this month
  assert.equal(m.savings.done, 25000);
  assert.equal(m.savings.remaining, 25000);
  assert.equal(m.transfers.upcoming.length, 1);
  assert.equal(m.spending.totalSpent, 150000);
  // monthCapacity reserves the remaining transfer once (no double count)
  assert.equal(m.cash.monthCapacity, m.cash.balanceNow + 200000 - 8000 - 25000);
  // A three-paycheck month schedules three transfers
  const jan = computeMonth(s, '2027-01', '2027-01-02');
  assert.equal(jan.savings.plan, 75000);
});

test('cash flow does not deduct a scheduled transfer twice', () => {
  const s = baseState({ budgets: [], settings: { balanceCents: 100000, balanceDate: '2026-11-15', balanceSetAt: '2026-11-15T08:00:00Z', bufferCents: 0 } });
  s.bills = [{ id: 'xfer', name: 'Brokerage', categoryId: 'savings', amountCents: 25000, frequency: 'biweekly', anchorDate: '2026-11-06' }];
  s.transactions = [pay('2026-11-06', 200000), tx('2026-11-06', 25000, 'savings', { billId: 'xfer', billDate: '2026-11-06' })];
  const cf = cashFlow(s, '2026-11-15', 10);
  const nov20 = cf.series.find(p => p.date === '2026-11-20');
  assert.equal(nov20.expected, 100000 + 200000 - 25000);
});

test('saving more than planned reduces what is left to spend (month-end sweep)', () => {
  const s = baseState();
  s.transactions = [pay('2026-11-06', 200000), pay('2026-11-20', 200000), tx('2026-11-10', 20000, 'groceries'),
    tx('2026-11-20', 50000, 'savings')];
  const before = computeMonth(s, '2026-11', '2026-11-28');
  assert.equal(before.variable.budgetRemaining, 80000);
  const sweep = sweepAmount(before);
  assert.equal(sweep, 80000);
  s.transactions.push(tx('2026-11-28', sweep, 'savings', { merchant: 'Month-end sweep' }));
  const after = computeMonth(s, '2026-11', '2026-11-28');
  assert.equal(after.savings.extra, 80000);
  assert.equal(after.variable.budgetRemaining, 0);
  assert.equal(after.cash.safeMonth, 0);
  assert.equal(sweepAmount(after), 0);
});

test('savings target projection: on pace vs behind, with a per-day fix', () => {
  // Income $4,000 (2 paychecks), fixed $1,580, $500 discretionary spent by day 15 → pace $1,000.
  const s = baseState({ settings: { balanceCents: 300000, balanceDate: '2026-10-31', balanceSetAt: '2026-10-31T23:00:00Z', bufferCents: 0, prefs: { savingsTargetPct: 30 } } });
  s.transactions = [tx('2026-11-01', 150000, 'housing', { billId: 'rent', billDate: '2026-11-01' }), pay('2026-11-06', 200000),
    tx('2026-11-03', 25000, 'restaurants'), tx('2026-11-08', 25000, 'groceries')];
  const m = computeMonth(s, '2026-11', '2026-11-15');
  const sv = m.saving;
  assert.equal(sv.income, 400000);
  assert.equal(sv.kept, 400000 - 150000 - 8000 - 100000);  // 142,000
  assert.equal(sv.target, 120000);
  assert.equal(sv.status, 'ahead');
  // Target 40% → $1,600: behind by $180 → about $11.25/day over 16 days
  const sv40 = savingProjection(m, 40);
  assert.equal(sv40.gap, -18000);
  assert.equal(sv40.status, 'behind');
  assert.equal(sv40.perDayCut, 1125);
  // Past month: actual
  const oct = savingProjection(computeMonth(s, '2026-10', '2026-11-15'), 30);
  assert.equal(oct.hasIncome, false);
});

test('a payday transfer follows the paycheck schedule, including weekend adjustment', () => {
  const s = baseState({ budgets: [] });
  s.incomeSources = [{ id: 'job', name: 'Pay', kind: 'paycheck', amountCents: 300000, frequency: 'semimonthly', semimonthlyDays: [15, 31], weekendAdjust: 'before', anchorDate: '2026-01-01' }];
  s.bills = [{ id: 'xfer', name: 'Roth IRA', categoryId: 'savings', amountCents: 40000, frequency: 'monthly', dayOfMonth: 1, startDate: '2026-11-01' }];
  s.settings.prefs = { billSources: { xfer: 'job' } };
  const m = computeMonth(s, '2026-11', '2026-11-02');
  assert.deepEqual(m.transfers.occurrences.map(o => o.date), ['2026-11-13', '2026-11-30']); // Nov 15 is a Sunday
  assert.equal(m.savings.plan, 80000);
  // Without the link it would just be monthly on the 1st
  s.settings.prefs = {};
  assert.deepEqual(computeMonth(s, '2026-11', '2026-11-02').transfers.occurrences.map(o => o.date), ['2026-11-01']);
});

test('sweep keeps enough to live on until payday and never sweeps during a shortfall', () => {
  // $1,000 budget/month (≈$33.33/day). Nov 29, payday Dec 4 → 5 days to cover ≈ $166.67.
  const s = baseState({ settings: { balanceCents: 40000, balanceDate: '2026-11-29', balanceSetAt: '2026-11-29T08:00:00Z', bufferCents: 0 }, bills: [] });
  s.incomeSources[0].anchorDate = '2026-12-04';
  s.transactions = [pay('2026-11-06', 200000), pay('2026-11-20', 200000), tx('2026-11-10', 50000, 'groceries'), tx('2026-11-21', 50000, 'savings')];
  const m = computeMonth(s, '2026-11', '2026-11-29');
  assert.equal(m.variable.budgetRemaining, 50000);
  assert.equal(m.cash.untilPay.days, 5);
  assert.equal(sweepAmount(m), 40000 - Math.round(100000 / 30 * 5)); // $233.33, not the full $500
  // Rent due before payday larger than the balance: no sweep at all
  s.bills = [{ id: 'rent', name: 'Rent', categoryId: 'housing', amountCents: 150000, frequency: 'monthly', dayOfMonth: 1 }];
  const m2 = computeMonth(s, '2026-11', '2026-11-29');
  assert.ok(m2.cash.untilPay.shortfall > 0);
  assert.equal(sweepAmount(m2), 0);
});
