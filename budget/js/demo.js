/* demo.js — default categories and removable sample data.
   Every sample row is tagged isDemo: true, so "Remove sample data" deletes exactly
   these rows and nothing you entered yourself. */
import { addDays, addMonths, monthKey, monthStart, weekday, toDayNum } from './dates.js';
import { occurrences } from './schedule.js';
import { newId } from './store.js';

export const DEFAULT_CATEGORIES = [
  // fixed
  { name: 'Rent & Housing', kind: 'fixed', icon: '🏠', color: '#7c9cff' },
  { name: 'Utilities', kind: 'fixed', icon: '💡', color: '#f5c04b' },
  { name: 'Internet', kind: 'fixed', icon: '🌐', color: '#5ec8e5' },
  { name: 'Phone', kind: 'fixed', icon: '📱', color: '#a78bfa' },
  { name: 'Insurance', kind: 'fixed', icon: '🛡️', color: '#60a5fa' },
  { name: 'Subscriptions', kind: 'fixed', icon: '🔁', color: '#f472b6' },
  { name: 'Debt Payments', kind: 'fixed', icon: '💳', color: '#fb7185' },
  { name: 'Car & Transportation', kind: 'fixed', icon: '🚗', color: '#94a3b8' },
  // variable
  { name: 'Groceries', kind: 'variable', icon: '🛒', color: '#34d399' },
  { name: 'Dining Out', kind: 'variable', icon: '🍽️', color: '#fb923c' },
  { name: 'Bars & Nightlife', kind: 'variable', icon: '🍸', color: '#c084fc' },
  { name: 'Shopping', kind: 'variable', icon: '🛍️', color: '#f87171' },
  { name: 'Entertainment', kind: 'variable', icon: '🎬', color: '#facc15' },
  { name: 'Rides & Uber', kind: 'variable', icon: '🚕', color: '#38bdf8' },
  { name: 'Travel', kind: 'variable', icon: '✈️', color: '#2dd4bf' },
  { name: 'Miscellaneous', kind: 'variable', icon: '📦', color: '#a3a3a3' },
  // savings
  { name: 'Savings', kind: 'savings', icon: '🏦', color: '#22c55e' },
];

export function defaultCategoryRows() {
  return DEFAULT_CATEGORIES.map((c, i) => ({ id: newId(), parentId: null, sort: i, archived: false, ...c }));
}

/* Deterministic PRNG so the demo looks the same every time. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MERCHANTS = {
  'Groceries': ['Trader Joe\'s', 'Whole Foods', 'Safeway', 'Costco'],
  'Dining Out': ['Sweetgreen', 'Chipotle', 'Joe\'s Pizza', 'Blue Bottle', 'Tacos El Gordo', 'Nobu'],
  'Bars & Nightlife': ['The Rusty Anchor', 'Bar Goto', 'Night Owl'],
  'Shopping': ['Amazon', 'Uniqlo', 'Target', 'Apple Store'],
  'Entertainment': ['AMC Theatres', 'Ticketmaster', 'Steam', 'Bowlero'],
  'Rides & Uber': ['Uber', 'Lyft', 'Citi Bike'],
  'Travel': ['Delta', 'Airbnb'],
  'Miscellaneous': ['CVS', 'USPS', 'Walgreens'],
};
// typical [min, max] in dollars and visits per week
const PATTERN = {
  'Groceries': [40, 110, 1.2], 'Dining Out': [12, 48, 2.0], 'Bars & Nightlife': [20, 55, 0.8],
  'Shopping': [15, 90, 0.6], 'Entertainment': [12, 40, 0.45], 'Rides & Uber': [8, 28, 1.0],
  'Travel': [80, 220, 0.08], 'Miscellaneous': [6, 30, 0.5],
};
const BUDGETS = {
  'Groceries': 55000, 'Dining Out': 35000, 'Bars & Nightlife': 15000, 'Shopping': 20000,
  'Entertainment': 12000, 'Rides & Uber': 12000, 'Travel': 10000, 'Miscellaneous': 10000, 'Savings': 50000,
};

/**
 * Build sample rows relative to `today`. Returns { categories (new ones only), rows, settings }.
 * The current month deliberately runs hot on Dining Out so the pace alerts have something to say.
 */
export function buildDemo(existingCategories, today) {
  const rand = rng(20261122);
  const between = (a, b) => Math.round((a + rand() * (b - a)) * 100);
  const cats = [...existingCategories];
  const newCats = [];
  const cat = name => {
    let c = cats.find(x => x.name === name && !x.parentId);
    if (!c) {
      const def = DEFAULT_CATEGORIES.find(d => d.name === name);
      c = { id: newId(), parentId: null, sort: cats.length, archived: false, isDemo: true, ...def };
      cats.push(c); newCats.push(c);
    }
    return c;
  };
  for (const d of DEFAULT_CATEGORIES) cat(d.name);
  // A demo subcategory
  const coffee = { id: newId(), name: 'Coffee', parentId: cat('Dining Out').id, kind: 'variable', icon: '☕', color: '#d6a36b', sort: 99, archived: false, isDemo: true };
  newCats.push(coffee);

  const startMonth = addMonths(monthKey(today), -3);
  const start = monthStart(startMonth);
  const D = { isDemo: true };
  const rows = { budgets: [], incomeSources: [], bills: [], transactions: [], goals: [] };
  const created = date => `${date}T${String(8 + Math.floor(rand() * 12)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00.000Z`;

  for (const [name, cents] of Object.entries(BUDGETS)) {
    rows.budgets.push({ id: newId(), categoryId: cat(name).id, month: startMonth, amountCents: cents, scope: 'from', ...D });
  }

  // Paycheck: biweekly Fridays, aligned to the most recent Friday on/before today.
  let fri = today; while (weekday(fri) !== 5) fri = addDays(fri, -1);
  const payAnchor = addDays(fri, -14 * 10);
  const job = { id: newId(), name: 'Paycheck — Acme Corp', kind: 'paycheck', amountCents: 245000, frequency: 'biweekly', anchorDate: payAnchor, startDate: start, weekendAdjust: 'none', active: true, ...D };
  const side = { id: newId(), name: 'Freelance design', kind: 'side', amountCents: 35000, frequency: 'monthly', anchorDate: start, startDate: start, dayOfMonth: 25, weekendAdjust: 'none', active: true, ...D };
  const bonus = { id: newId(), name: 'Year-end bonus', kind: 'bonus', amountCents: 150000, frequency: 'once', anchorDate: addDays(monthStart(addMonths(monthKey(today), 1)), 14), active: true, ...D };
  rows.incomeSources.push(job, side, bonus);

  const bill = (name, catName, cents, dayOfMonth, extra = {}) => {
    const b = { id: newId(), name, categoryId: cat(catName).id, amountCents: cents, frequency: 'monthly', anchorDate: start, startDate: start, dayOfMonth, autopay: true, active: true, ...D, ...extra };
    rows.bills.push(b); return b;
  };
  bill('Rent', 'Rent & Housing', 185000, 1, { autopay: false });
  bill('Electric', 'Utilities', 9500, 12);
  bill('Internet', 'Internet', 7000, 18);
  bill('Phone', 'Phone', 8500, 22);
  bill('Car insurance', 'Insurance', 14200, 28);
  bill('Spotify', 'Subscriptions', 1199, 7);
  bill('Netflix', 'Subscriptions', 1549, 15);
  bill('Gym', 'Subscriptions', 4500, 3);
  bill('Student loan', 'Debt Payments', 32000, 20);
  bill('Car payment', 'Car & Transportation', 38900, 9);
  bill('Renters insurance', 'Insurance', 18000, null, { frequency: 'annually', anchorDate: `${Number(today.slice(0, 4)) - 1}-12-05`, dayOfMonth: 5 });

  const emergency = { id: newId(), name: 'Emergency fund', kind: 'target', targetCents: 1000000, startingCents: 320000, targetDate: `${Number(today.slice(0, 4)) + 1}-12-31`, icon: '🛟', color: '#22c55e', archived: false, ...D };
  const trip = { id: newId(), name: 'Japan trip', kind: 'target', targetCents: 400000, startingCents: 60000, targetDate: `${Number(today.slice(0, 4)) + 1}-06-30`, icon: '🗾', color: '#38bdf8', archived: false, ...D };
  const monthly = { id: newId(), name: 'Save $500 every month', kind: 'monthly', targetCents: 50000, startingCents: 0, icon: '📈', color: '#a78bfa', archived: false, ...D };
  rows.goals.push(emergency, trip, monthly);

  // Pay yourself first: $250 to the brokerage account every payday (follows the paycheck schedule).
  const xfer = { id: newId(), name: 'Brokerage', categoryId: cat('Savings').id, amountCents: 25000, frequency: 'biweekly', anchorDate: payAnchor, startDate: start, autopay: false, active: true, ...D };
  rows.bills.push(xfer);

  const T = (date, cents, categoryId, merchant, extra = {}) =>
    rows.transactions.push({ id: newId(), kind: 'expense', date, amountCents: cents, categoryId, merchant, notes: '', createdAt: created(date), ...D, ...extra });

  // Income received + savings moved on each payday that has already happened.
  for (const d of occurrences(job, start, today)) {
    rows.transactions.push({ id: newId(), kind: 'income', date: d, amountCents: job.amountCents, incomeSourceId: job.id, incomeDate: d, merchant: 'Acme Corp payroll', createdAt: created(d), ...D });
    T(d, 25000, cat('Savings').id, 'Brokerage', { goalId: emergency.id, billId: xfer.id, billDate: d });
  }
  for (const d of occurrences(side, start, addDays(today, -1))) {
    rows.transactions.push({ id: newId(), kind: 'income', date: d, amountCents: side.amountCents, incomeSourceId: side.id, incomeDate: d, merchant: 'Client invoice', createdAt: created(d), ...D });
  }
  // Bills paid on their due date (anything due today is left for you to mark paid).
  for (const b of rows.bills) {
    if (b === xfer) continue;
    for (const d of occurrences(b, start, addDays(today, -1))) {
      const amt = b.name === 'Electric' ? b.amountCents + between(-18, 22) : b.amountCents;
      T(d, amt, b.categoryId, b.name, { billId: b.id, billDate: d });
    }
  }
  // Discretionary spending.
  const curMonth = monthKey(today);
  for (let n = toDayNum(start); n <= toDayNum(today); n++) {
    const d = addDays(start, n - toDayNum(start));
    const wd = weekday(d);
    const hot = monthKey(d) === curMonth;
    for (const [name, [lo, hi, perWeek]] of Object.entries(PATTERN)) {
      let p = perWeek / 7;
      if (name === 'Bars & Nightlife') p = wd === 5 || wd === 6 ? perWeek / 2 : 0;
      if (name === 'Dining Out' && hot) p *= 1.6;
      if (rand() < p) {
        const list = MERCHANTS[name];
        const m = list[Math.floor(rand() * list.length)];
        const isCoffee = name === 'Dining Out' && m === 'Blue Bottle';
        T(d, isCoffee ? between(5, 9) : between(lo, hi), isCoffee ? coffee.id : cat(name).id, m);
      }
    }
  }
  rows.transactions.push({ id: newId(), kind: 'expense', date: addDays(today, -2), amountCents: -2499, categoryId: cat('Shopping').id, merchant: 'Amazon', notes: 'Refund — returned headphones', createdAt: created(addDays(today, -2)), ...D });

  const settings = { balanceCents: 165000, balanceDate: addDays(start, -1), balanceSetAt: `${addDays(start, -1)}T23:59:00.000Z`, bufferCents: 20000, demoBalance: true,
    prefs: { billSources: { [xfer.id]: job.id }, billGoals: { [xfer.id]: emergency.id }, savingsTargetPct: 25, demoTarget: true } };
  return { categories: [...newCats], rows, settings };
}
