/* csv.js — exports, backups and CSV import. Money is written from integer cents. */
import { toDecimal, parseMoney } from './money.js';
import { categoryIndex, computeMonth } from './engine.js';
import { addMonths, monthKey, isValidISO } from './dates.js';
import { COLLECTIONS } from './store.js';

const cell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) && isNaN(Number(s)) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function transactionsCSV(state) {
  const idx = categoryIndex(state);
  const rows = [['date', 'type', 'amount', 'category', 'subcategory', 'merchant', 'notes', 'bill', 'income_source', 'goal', 'id']];
  const list = state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of list) {
    const c = idx.byId.get(t.categoryId);
    const root = idx.root(t.categoryId);
    const type = t.kind === 'income' ? 'income' : root?.kind === 'savings' ? 'savings' : t.amountCents < 0 ? 'refund' : 'expense';
    const signed = t.kind === 'income' ? t.amountCents : -t.amountCents;
    rows.push([t.date, type, toDecimal(signed), root?.name || '', c && c.parentId ? c.name : '', t.merchant || '', t.notes || '',
      state.bills.find(b => b.id === t.billId)?.name || '', state.incomeSources.find(s => s.id === t.incomeSourceId)?.name || '',
      state.goals.find(g => g.id === t.goalId)?.name || '', t.id]);
  }
  return toCSV(rows);
}

export function summaryCSV(state, today) {
  const months = new Set(state.transactions.map(t => monthKey(t.date)));
  months.add(monthKey(today));
  const sorted = [...months].sort();
  // include gaps
  const all = [];
  if (sorted.length) for (let m = sorted[0]; m <= sorted[sorted.length - 1]; m = addMonths(m, 1)) all.push(m);
  const rows = [['month', 'income_received', 'income_expected', 'fixed_spent', 'variable_spent', 'variable_budget', 'saved', 'savings_plan', 'total_spent', 'savings_rate_pct', 'status']];
  for (const m of all) {
    const s = computeMonth(state, m, today);
    rows.push([m, toDecimal(s.income.receivedCents), toDecimal(s.income.expectedCents), toDecimal(s.spending.fixedSpent), toDecimal(s.spending.variableSpent),
      toDecimal(s.variable.budget), toDecimal(s.savings.done), toDecimal(s.savings.plan), toDecimal(s.spending.totalSpent),
      s.savingsRate === null ? '' : (s.savingsRate * 100).toFixed(1), s.status]);
  }
  rows.push([]);
  rows.push(['category_budgets_by_month']);
  rows.push(['month', 'category', 'kind', 'budget', 'spent', 'status']);
  for (const m of all) {
    const s = computeMonth(state, m, today);
    for (const l of s.lines) rows.push([m, l.category.name, l.kind, toDecimal(l.budget), toDecimal(l.spent), l.status]);
  }
  return toCSV(rows);
}

export function backupJSON(state) {
  const out = { app: 'runway', version: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  for (const c of COLLECTIONS) out[c] = state[c];
  return JSON.stringify(out, null, 2);
}

export function parseBackup(text) {
  const d = JSON.parse(text);
  if (d.app !== 'runway' || !Array.isArray(d.transactions)) throw new Error('This file is not a Runway backup.');
  for (const c of COLLECTIONS) if (!Array.isArray(d[c])) d[c] = [];
  for (const t of d.transactions) if (!Number.isInteger(t.amountCents)) throw new Error('Backup contains an invalid amount.');
  return d;
}

/** RFC 4180-ish CSV parser. */
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

function normDate(s) {
  s = String(s || '').trim();
  if (isValidISO(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // US m/d/y
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return isValidISO(iso) ? iso : null;
  }
  return null;
}

/**
 * Turn CSV text into transaction rows. Columns are matched by header name:
 * date, amount, category, merchant/description, notes, type. Positive amounts are
 * expenses unless type=income; negative amounts in a bank export are spending.
 */
export function importTransactions(text, state) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('No rows found.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const ci = { date: col('date', 'transaction date', 'posted date'), amount: col('amount', 'amt'), category: col('category'), sub: col('subcategory'),
    merchant: col('merchant', 'description', 'payee', 'name'), notes: col('notes', 'memo'), type: col('type', 'kind') };
  if (ci.date < 0 || ci.amount < 0) throw new Error('CSV needs at least "date" and "amount" columns.');
  const byName = new Map(state.categories.map(c => [c.name.toLowerCase(), c]));
  const newCats = [];
  const getCat = (name, sub) => {
    if (!name) return null;
    let c = byName.get(name.toLowerCase());
    if (!c) { c = { id: crypto.randomUUID(), name, kind: 'variable', icon: '📦', color: '#94a3b8', parentId: null }; byName.set(name.toLowerCase(), c); newCats.push(c); }
    if (sub) {
      let s = state.categories.concat(newCats).find(x => x.parentId === c.id && x.name.toLowerCase() === sub.toLowerCase());
      if (!s) { s = { id: crypto.randomUUID(), name: sub, kind: c.kind, icon: c.icon, color: c.color, parentId: c.id }; newCats.push(s); }
      return s.id;
    }
    return c.id;
  };
  const out = [], errors = [];
  rows.slice(1).forEach((r, i) => {
    const d = normDate(r[ci.date]);
    const c = parseMoney(r[ci.amount]);
    if (!d || c === null || c === 0) { errors.push(i + 2); return; }
    const type = ci.type >= 0 ? String(r[ci.type] || '').trim().toLowerCase() : '';
    const isIncome = type === 'income' || type === 'deposit' || type === 'credit';
    const isRefund = type === 'refund';
    // With a type column (our own export): income / refund / expense / savings.
    // Without one, every row is treated as spending (sign ignored).
    let amount = Math.abs(c);
    if (!isIncome && isRefund) amount = -amount;
    const row = { kind: isIncome ? 'income' : 'expense', date: d, amountCents: amount, merchant: ci.merchant >= 0 ? r[ci.merchant]?.trim() || null : null, notes: ci.notes >= 0 ? r[ci.notes]?.trim() || null : null, categoryId: null };
    if (!isIncome) row.categoryId = getCat(ci.category >= 0 ? r[ci.category]?.trim() : '', ci.sub >= 0 ? r[ci.sub]?.trim() : '');
    out.push(row);
  });
  return { transactions: out, categories: newCats, errors };
}
