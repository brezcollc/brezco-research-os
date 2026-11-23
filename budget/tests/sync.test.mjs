// Sync-layer tests with an in-memory fake of Supabase that enforces the real
// schema's NOT NULL columns (parsed from supabase/schema.sql).
// Run: node --test budget/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Minimal browser shims for store.js
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k), clear: () => mem.clear(),
};

const { TABLES, toRow } = await import('../js/cloud.js');
const { Store } = await import('../js/store.js');
const { defaultCategoryRows, buildDemo } = await import('../js/demo.js');

const sql = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const NOT_NULL = {};
for (const m of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
  NOT_NULL[m[1]] = [...m[2].matchAll(/^\s+(\w+)\s+[^\n]*not null/gm)].map(x => x[1]);
}
const tableOf = coll => (coll === 'settings' ? 'budget_settings' : TABLES[coll].table);

/** Fake Supabase backend: rejects NULL in NOT NULL columns like Postgres (code 23502). */
function fakeCloud() {
  const db = new Map(); // table -> Map(id -> row)
  const tbl = t => { if (!db.has(t)) db.set(t, new Map()); return db.get(t); };
  const calls = { push: 0 };
  const settingsCols = ['balance_cents', 'balance_date', 'balance_set_at', 'buffer_cents', 'demo_balance', 'prefs', 'updated_at'];
  const validate = (table, row) => {
    for (const c of NOT_NULL[table]) if (c in row && row[c] === null) return { code: '23502', message: `null value in column "${c}" violates not-null constraint` };
    return null;
  };
  const cloud = {
    async pullAll(userId) {
      const out = {};
      for (const [coll, def] of Object.entries(TABLES)) {
        out[coll] = [...tbl(def.table).values()].filter(r => r.user_id === userId).map(r => {
          const o = {}; for (const [k, v] of Object.entries(r)) if (k !== 'user_id' && v !== null) o[k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = v; return o;
        });
      }
      const s = tbl('budget_settings').get(userId);
      out.settings = s ? { id: 'settings', balanceCents: s.balance_cents, bufferCents: s.buffer_cents, prefs: s.prefs } : null;
      return out;
    },
    async push(ops, userId) {
      calls.push++;
      const rejected = [];
      for (const o of ops) {
        const table = tableOf(o.coll);
        if (o.op === 'delete') { tbl(table).delete(o.id); continue; }
        const row = o.coll === 'settings' ? toRow(settingsCols, o.row, userId, table) : toRow(TABLES[o.coll].cols, o.row, userId, table);
        const err = validate(table, row);
        if (err) { rejected.push({ op: o, error: err.message }); continue; }
        tbl(table).set(o.coll === 'settings' ? userId : row.id, row);
      }
      return { rejected };
    },
    async signOut() {},
  };
  return { cloud, db, tbl, calls };
}

function newStore(fake) {
  const s = new Store();
  s._cloud = { cloud: fake.cloud, SetupRequiredError: class extends Error {} };
  return s;
}
const session = id => ({ user: { id, email: `${id}@example.com` } });

test('every kind of row a user creates is accepted by the schema (no NULL in NOT NULL columns)', () => {
  const now = new Date().toISOString();
  const samples = {
    categories: defaultCategoryRows()[0],
    budgets: { id: 'b', categoryId: 'c', month: '2026-11', amountCents: 100 },
    incomeSources: { id: 'i', name: 'Pay', amountCents: 1, frequency: 'biweekly', anchorDate: '2026-11-06' },
    bills: { id: 'x', name: 'Rent', amountCents: 1, frequency: 'monthly', dayOfMonth: 1 },
    transactions: { id: 't', date: '2026-11-22', amountCents: 500, categoryId: 'c', createdAt: now },
    goals: { id: 'g', name: 'Fund', targetCents: 100 },
  };
  for (const [coll, obj] of Object.entries(samples)) {
    const row = toRow(TABLES[coll].cols, obj, 'u', TABLES[coll].table);
    const nulls = NOT_NULL[TABLES[coll].table].filter(c => c in row && row[c] === null);
    assert.deepEqual(nulls, [], `${coll} sends NULL for ${nulls}`);
  }
  // Settings row before a balance is ever set
  const srow = toRow(['balance_cents', 'balance_date', 'balance_set_at', 'buffer_cents', 'demo_balance', 'prefs', 'updated_at'], { id: 'settings', prefs: undefined }, 'u', 'budget_settings');
  assert.deepEqual(NOT_NULL.budget_settings.filter(c => c in srow && srow[c] === null), []);
  // Explicitly cleared optional links stay NULL (e.g. unlinking a goal)
  assert.equal(toRow(TABLES.transactions.cols, { goalId: null }, 'u', 'budget_transactions').goal_id, null);
});

test('first sign-in: defaults + a real transaction reach the server', async () => {
  mem.clear();
  const fake = fakeCloud();
  const s = newStore(fake);
  await s.startCloud(session('alice'));
  s.batch(tx => { for (const c of defaultCategoryRows()) tx.upsert('categories', c); tx.settings({ prefs: { initialized: true } }); });
  s.setBalance(250000, '2026-11-22');
  s.upsert('transactions', { kind: 'expense', date: '2026-11-22', amountCents: 1299, categoryId: s.state.categories[0].id, merchant: 'Cafe' });
  await s.flush(true);
  assert.equal(s.outbox.length, 0);
  assert.equal(s.sync.error, null);
  assert.equal(fake.tbl('budget_categories').size, 17);
  assert.equal(fake.tbl('budget_transactions').size, 1);
  assert.equal(fake.tbl('budget_settings').get('alice').balance_cents, 250000);
});

test('device-only data is uploaded when signing in to an empty account', async () => {
  mem.clear();
  const local = new Store();
  local.startLocal();
  local.batch(tx => { for (const c of defaultCategoryRows()) tx.upsert('categories', c); });
  local.upsert('transactions', { kind: 'expense', date: '2026-11-20', amountCents: 4200, categoryId: local.state.categories[9].id });
  const fake = fakeCloud();
  const s = newStore(fake);
  await s.startCloud(session('bob'));
  assert.equal(fake.tbl('budget_transactions').size, 1);
  assert.equal(s.state.transactions.length, 1);
  assert.ok(Store.readNamespace('runway.v1.local').transactions.length === 1, 'device copy is kept');
});

test('an existing account is not overwritten by device-only data', async () => {
  mem.clear();
  const fake = fakeCloud();
  const a = newStore(fake);
  await a.startCloud(session('carol'));
  a.upsert('categories', { name: 'Cloud cat', kind: 'variable' });
  await a.flush(true);
  mem.clear(); // new phone: has device data, account already has data
  const local = new Store(); local.startLocal(); local.upsert('categories', { name: 'Device cat', kind: 'variable' });
  const b = newStore(fake);
  await b.startCloud(session('carol'));
  assert.deepEqual(b.state.categories.map(c => c.name), ['Cloud cat']);
});

test('offline edits queue up and sync later; a rejected row does not block the rest', async () => {
  mem.clear();
  const fake = fakeCloud();
  const s = newStore(fake);
  await s.startCloud(session('dave'));
  const realPush = fake.cloud.push;
  fake.cloud.push = async () => { throw new Error('Failed to fetch'); };
  s.upsert('transactions', { kind: 'expense', date: '2026-11-22', amountCents: 100, categoryId: null });
  await s.flush().catch(() => {});
  assert.equal(s.outbox.length, 1, 'kept while offline');
  // Survives a reload
  const again = newStore(fake); again.mode = 'cloud'; again.user = { id: 'dave' }; again.loadLocal();
  assert.equal(again.outbox.length, 1);
  fake.cloud.push = realPush;
  // a corrupt row (name missing → NOT NULL) plus a good one
  s.outbox.push({ op: 'upsert', coll: 'goals', id: 'bad', row: { id: 'bad', name: null, targetCents: 1 } });
  await s.flush(true);
  assert.equal(s.outbox.length, 0);
  assert.equal(fake.tbl('budget_transactions').size, 1);
  assert.match(s.sync.error, /rejected/);
});

test('sample data rows are all accepted, and removing them deletes them server-side', async () => {
  mem.clear();
  const fake = fakeCloud();
  const s = newStore(fake);
  await s.startCloud(session('erin'));
  s.batch(tx => { for (const c of defaultCategoryRows()) tx.upsert('categories', c); });
  const d = buildDemo(s.state.categories, '2026-11-22');
  s.batch(tx => { for (const c of d.categories) tx.upsert('categories', c); for (const [coll, rows] of Object.entries(d.rows)) for (const r of rows) tx.upsert(coll, r); tx.settings(d.settings); });
  await s.flush(true);
  assert.equal(s.sync.error, null);
  const n = fake.tbl('budget_transactions').size;
  assert.ok(n > 100);
  s.removeDemo();
  await s.flush(true);
  assert.equal(fake.tbl('budget_transactions').size, 0);
  assert.equal(fake.tbl('budget_categories').size, 17);
});
