/* cloud.js — Supabase adapter. Maps app collections <-> normalized tables.
   Loaded lazily so the app works fully offline / in device-only mode. */
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_JS } from './config.js';

export const TABLES = {
  categories: { table: 'budget_categories', cols: ['id', 'name', 'parent_id', 'kind', 'icon', 'color', 'sort', 'archived', 'is_demo', 'created_at', 'updated_at'] },
  budgets: { table: 'budget_budgets', cols: ['id', 'category_id', 'month', 'amount_cents', 'scope', 'is_demo', 'created_at', 'updated_at'] },
  incomeSources: { table: 'budget_income_sources', cols: ['id', 'name', 'kind', 'amount_cents', 'frequency', 'anchor_date', 'start_date', 'day_of_month', 'semimonthly_days', 'interval_days', 'weekend_adjust', 'end_date', 'active', 'notes', 'is_demo', 'created_at', 'updated_at'] },
  bills: { table: 'budget_bills', cols: ['id', 'name', 'category_id', 'amount_cents', 'frequency', 'anchor_date', 'start_date', 'day_of_month', 'interval_days', 'end_date', 'autopay', 'active', 'notes', 'is_demo', 'created_at', 'updated_at'] },
  transactions: { table: 'budget_transactions', cols: ['id', 'kind', 'date', 'amount_cents', 'category_id', 'merchant', 'notes', 'bill_id', 'bill_date', 'income_source_id', 'income_date', 'goal_id', 'is_demo', 'created_at', 'updated_at'] },
  goals: { table: 'budget_goals', cols: ['id', 'name', 'kind', 'target_cents', 'starting_cents', 'target_date', 'icon', 'color', 'archived', 'notes', 'is_demo', 'created_at', 'updated_at'] },
};
const SETTINGS = { table: 'budget_settings', cols: ['balance_cents', 'balance_date', 'balance_set_at', 'buffer_cents', 'demo_balance', 'prefs', 'updated_at'] };

const snake = k => k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const camel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/* Columns that are NOT NULL in the schema. A missing value must be sent as the
   column's default — sending NULL makes Postgres reject the whole write. */
const NOT_NULL_DEFAULTS = {
  is_demo: false, archived: false, sort: 0, active: true, autopay: false, weekend_adjust: 'none',
  scope: 'from', buffer_cents: 0, demo_balance: false, starting_cents: 0,
};
const KIND_DEFAULT = { budget_categories: 'variable', budget_income_sources: 'paycheck', budget_transactions: 'expense', budget_goals: 'target' };

export function toRow(cols, obj, userId, table = '') {
  const row = { user_id: userId };
  const now = new Date().toISOString();
  for (const c of cols) {
    let v = obj[camel(c)];
    if (v === undefined || v === '') v = null;
    if (v === null) {
      if (c in NOT_NULL_DEFAULTS) v = NOT_NULL_DEFAULTS[c];
      else if (c === 'created_at' || c === 'updated_at') v = now;
      else if (c === 'prefs') v = {};
      else if (c === 'kind' && KIND_DEFAULT[table]) v = KIND_DEFAULT[table];
    }
    row[c] = v;
  }
  return row;
}
function fromRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) if (k !== 'user_id' && v !== null) o[camel(k)] = v;
  return o;
}

let client = null;
export async function getClient() {
  if (client) return client;
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'runway.auth' },
  });
  return client;
}

export class SetupRequiredError extends Error {}
/** Postgres data/constraint errors (classes 22 and 23): retrying the same row can never succeed. */
const isDataError = e => /^2[23]/.test(e?.code || '');
function check(error) {
  if (!error) return;
  if (['PGRST205', '42P01', 'PGRST204'].includes(error.code) || /does not exist|schema cache/i.test(error.message || '')) {
    throw new SetupRequiredError('Database tables are missing. Run budget/supabase/schema.sql in the Supabase SQL editor.');
  }
  throw new Error(error.message || String(error));
}

export const cloud = {
  async session() {
    const sb = await getClient();
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  },
  async signIn(email, password) {
    const sb = await getClient();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return data.session;
  },
  async signUp(email, password) {
    const sb = await getClient();
    const { data, error } = await sb.auth.signUp({
      email: email.trim(), password,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
    return data; // session is null when email confirmation is required
  },
  async resetPassword(email) {
    const sb = await getClient();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
  },
  async updatePassword(password) {
    const sb = await getClient();
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
  },
  async signOut() { const sb = await getClient(); await sb.auth.signOut(); },
  async onAuth(cb) { const sb = await getClient(); return sb.auth.onAuthStateChange((evt, session) => cb(evt, session)); },

  /** Load everything for the signed-in user. */
  async pullAll(userId) {
    const sb = await getClient();
    const out = {};
    for (const [coll, def] of Object.entries(TABLES)) {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(def.table).select('*').order('id').range(from, from + 999);
        check(error);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      out[coll] = rows.map(fromRow);
    }
    const { data: srow, error } = await sb.from(SETTINGS.table).select('*').eq('user_id', userId).maybeSingle();
    check(error);
    out.settings = srow ? { id: 'settings', ...fromRow(srow) } : null;
    return out;
  },

  /** Apply queued operations: [{op:'upsert'|'delete', coll, row|id}].
      Returns the ops the server permanently rejected (bad data) so they don't block the queue. */
  async push(ops, userId) {
    const sb = await getClient();
    const ups = new Map(), dels = new Map();
    const rejected = [];
    for (const o of ops) {
      if (o.coll === 'settings') {
        const { error } = await sb.from(SETTINGS.table).upsert(toRow(SETTINGS.cols, o.row, userId, SETTINGS.table), { onConflict: 'user_id' });
        if (error && isDataError(error)) { rejected.push({ op: o, error: error.message }); continue; }
        check(error);
        continue;
      }
      const m = o.op === 'delete' ? dels : ups;
      if (!m.has(o.coll)) m.set(o.coll, []);
      m.get(o.coll).push(o.op === 'delete' ? o.id : { op: o, row: toRow(TABLES[o.coll].cols, o.row, userId, TABLES[o.coll].table) });
    }
    for (const [coll, items] of ups) {
      for (let i = 0; i < items.length; i += 500) {
        const chunk = items.slice(i, i + 500);
        const { error } = await sb.from(TABLES[coll].table).upsert(chunk.map(x => x.row), { onConflict: 'id' });
        if (error && isDataError(error)) {
          // One bad row fails the batch: retry row by row and set aside only the bad ones.
          for (const x of chunk) {
            const r = await sb.from(TABLES[coll].table).upsert(x.row, { onConflict: 'id' });
            if (r.error && isDataError(r.error)) rejected.push({ op: x.op, error: r.error.message });
            else check(r.error);
          }
          continue;
        }
        check(error);
      }
    }
    for (const [coll, ids] of dels) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from(TABLES[coll].table).delete().in('id', ids.slice(i, i + 200));
        check(error);
      }
    }
    return { rejected };
  },
};
