// Browser stand-in for @supabase/supabase-js used by tests/ui.cloud.e2e.cjs.
// Behaves like the real project in the ways that matter: NOT NULL columns reject
// NULL (code 23502), existing emails get an identity-less sign-up response, and a
// user created by email link has no password.
const NOT_NULL = {
  budget_settings: ['buffer_cents', 'demo_balance', 'prefs', 'updated_at'],
  budget_categories: ['name', 'kind', 'sort', 'archived', 'is_demo', 'created_at', 'updated_at'],
  budget_budgets: ['category_id', 'month', 'amount_cents', 'scope', 'is_demo', 'created_at', 'updated_at'],
  budget_income_sources: ['name', 'kind', 'amount_cents', 'frequency', 'weekend_adjust', 'active', 'is_demo', 'created_at', 'updated_at'],
  budget_bills: ['name', 'amount_cents', 'frequency', 'autopay', 'active', 'is_demo', 'created_at', 'updated_at'],
  budget_transactions: ['kind', 'date', 'amount_cents', 'is_demo', 'created_at', 'updated_at'],
  budget_goals: ['name', 'kind', 'target_cents', 'starting_cents', 'archived', 'is_demo', 'created_at', 'updated_at'],
};
const load = () => JSON.parse(sessionStorage.getItem('fakeSupabase') || '{"users":{"me@example.com":{"id":"u-existing","password":null}},"tables":{}}');
const save = db => sessionStorage.setItem('fakeSupabase', JSON.stringify(db));
const session = (email, id) => ({ access_token: 't', user: { id, email } });

export function createClient() {
  const auth = {
    async getSession() { const s = localStorage.getItem('fake.session'); return { data: { session: s ? JSON.parse(s) : null } }; },
    async signInWithPassword({ email, password }) {
      const u = load().users[email];
      if (!u || u.password !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
      const s = session(email, u.id); localStorage.setItem('fake.session', JSON.stringify(s));
      return { data: { session: s }, error: null };
    },
    async signUp({ email, password }) {
      const db = load();
      if (db.users[email]) return { data: { user: { id: 'obfuscated', identities: [] }, session: null }, error: null };
      db.users[email] = { id: 'u-' + Math.random().toString(36).slice(2), password }; save(db);
      const s = session(email, db.users[email].id); localStorage.setItem('fake.session', JSON.stringify(s));
      return { data: { user: { id: db.users[email].id, identities: [{}] }, session: s }, error: null };
    },
    async resetPasswordForEmail(email) {
      // Test shortcut: the "emailed link" immediately sets this password.
      const db = load(); if (db.users[email]) { db.users[email].password = 'newpassword1'; save(db); } return { error: null };
    },
    async updateUser() { return { error: null }; },
    async signOut() { localStorage.removeItem('fake.session'); return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  };
  const from = table => {
    const q = { filters: [], table };
    const rowsOf = db => Object.values(db.tables[table] || {});
    const uid = () => JSON.parse(localStorage.getItem('fake.session') || 'null')?.user?.id;
    const api = {
      select() { return api; },
      order() { return api; },
      eq(col, v) { q.filters.push(r => r[col] === v); return api; },
      range(a, b) { const db = load(); return Promise.resolve({ data: rowsOf(db).filter(r => r.user_id === uid()).slice(a, b + 1), error: null }); },
      maybeSingle() { const db = load(); return Promise.resolve({ data: rowsOf(db).find(r => q.filters.every(f => f(r))) || null, error: null }); },
      upsert(rows, { onConflict }) {
        const db = load(); db.tables[table] = db.tables[table] || {};
        for (const r of [].concat(rows)) {
          for (const c of NOT_NULL[table]) if (c in r && r[c] === null) return Promise.resolve({ error: { code: '23502', message: `null value in column "${c}" of relation "${table}" violates not-null constraint` } });
          if (r.user_id !== uid()) return Promise.resolve({ error: { code: '42501', message: 'new row violates row-level security policy' } });
        }
        for (const r of [].concat(rows)) db.tables[table][r[onConflict]] = r;
        save(db); return Promise.resolve({ error: null });
      },
      delete() { return { in(col, ids) { const db = load(); for (const id of ids) delete (db.tables[table] || {})[id]; save(db); return Promise.resolve({ error: null }); } }; },
    };
    return api;
  };
  return { auth, from };
}
