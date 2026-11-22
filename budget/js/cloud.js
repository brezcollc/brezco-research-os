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

function toRow(cols, obj, userId) {
  const row = { user_id: userId };
  for (const c of cols) {
    const v = obj[camel(c)];
    row[c] = v === undefined || v === '' ? null : v;
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
        const { data, error } = await sb.from(def.table).select('*').range(from, from + 999);
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

  /** Apply queued operations: [{op:'upsert'|'delete', coll, row|id}] */
  async push(ops, userId) {
    const sb = await getClient();
    const ups = new Map(), dels = new Map();
    for (const o of ops) {
      if (o.coll === 'settings') {
        const { error } = await sb.from(SETTINGS.table).upsert(toRow(SETTINGS.cols, o.row, userId), { onConflict: 'user_id' });
        check(error);
        continue;
      }
      const m = o.op === 'delete' ? dels : ups;
      if (!m.has(o.coll)) m.set(o.coll, []);
      m.get(o.coll).push(o.op === 'delete' ? o.id : toRow(TABLES[o.coll].cols, o.row, userId));
    }
    for (const [coll, rows] of ups) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from(TABLES[coll].table).upsert(rows.slice(i, i + 500), { onConflict: 'id' });
        check(error);
      }
    }
    for (const [coll, ids] of dels) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from(TABLES[coll].table).delete().in('id', ids.slice(i, i + 200));
        check(error);
      }
    }
  },
};
