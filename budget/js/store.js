/* store.js — local-first state with optional cloud sync.

   • The whole dataset lives in memory and is mirrored to localStorage, so the app
     opens instantly and keeps working offline (subway, airplane mode).
   • In cloud mode every change is also queued in an outbox and pushed to Supabase;
     the outbox survives reloads and is retried when the connection returns.
   • Device-only data and each cloud account use separate storage namespaces, so
     signing in or out never destroys data.                                       */

import { todayISO } from './dates.js';

export const COLLECTIONS = ['categories', 'budgets', 'incomeSources', 'bills', 'transactions', 'goals'];
const PREFIX = 'runway.v1';
const MODE_KEY = `${PREFIX}.mode`;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));
export const newId = uuid;
const nowISO = () => new Date().toISOString();

function emptyState() {
  return {
    settings: { id: 'settings', balanceCents: null, balanceDate: null, balanceSetAt: null, bufferCents: 0, prefs: {} },
    categories: [], budgets: [], incomeSources: [], bills: [], transactions: [], goals: [],
  };
}

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }
function safeDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

class Store {
  constructor() {
    this.state = emptyState();
    this.mode = null;          // 'local' | 'cloud'
    this.user = null;          // { id, email } in cloud mode
    this.outbox = [];
    this.sync = { status: 'idle', error: null, lastSync: null, setupRequired: false };
    this.listeners = new Set();
    this._flushTimer = null;
    this._cloud = null;
  }

  /* ---------- persistence ---------- */
  get ns() { return this.mode === 'cloud' ? `${PREFIX}.cloud.${this.user.id}` : `${PREFIX}.local`; }
  loadLocal() {
    const raw = safeGet(`${this.ns}.data`);
    this.state = emptyState();
    if (raw) {
      try {
        const d = JSON.parse(raw);
        for (const c of COLLECTIONS) this.state[c] = Array.isArray(d[c]) ? d[c] : [];
        this.state.settings = { ...this.state.settings, ...(d.settings || {}) };
      } catch { /* corrupted cache — start clean */ }
    }
    try { this.outbox = JSON.parse(safeGet(`${this.ns}.outbox`) || '[]'); } catch { this.outbox = []; }
  }
  persist() {
    const ok = safeSet(`${this.ns}.data`, JSON.stringify(this.state));
    if (this.mode === 'cloud') safeSet(`${this.ns}.outbox`, JSON.stringify(this.outbox));
    if (!ok) this.sync.error = 'Device storage is full — export a backup.';
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason) { for (const fn of this.listeners) fn(reason); }

  static savedMode() { try { return JSON.parse(safeGet(MODE_KEY) || 'null'); } catch { return null; } }
  static hasLocalData() { return !!safeGet(`${PREFIX}.local.data`); }

  /* ---------- modes ---------- */
  startLocal() {
    this.mode = 'local'; this.user = null;
    safeSet(MODE_KEY, JSON.stringify({ mode: 'local' }));
    this.loadLocal();
    this.sync = { status: 'local', error: null, lastSync: null, setupRequired: false };
    this.emit('load');
  }

  async mod() { this._cloud = this._cloud || (await import('./cloud.js')); return this._cloud; }

  /** Offline launch with no auth library available: open the cached copy; sync later. */
  startCloudCached(user) {
    this.mode = 'cloud'; this.user = user;
    this.loadLocal();
    this.sync = { status: 'offline', error: 'Offline — showing your saved copy. Changes will sync later.', lastSync: null, setupRequired: false };
    this.emit('load');
  }

  async startCloud(session) {
    await this.mod();
    this.mode = 'cloud';
    this.user = { id: session.user.id, email: session.user.email };
    safeSet(MODE_KEY, JSON.stringify({ mode: 'cloud', userId: this.user.id, email: this.user.email }));
    this.loadLocal();            // cached copy first: instant + offline
    this.emit('load');
    await this.syncNow({ pull: true });
  }

  async signOut() {
    if (this.mode === 'cloud') {
      try { await this.flush(); } catch { /* keep outbox for next sign in */ }
      try { await (await this.mod()).cloud.signOut(); } catch { /* offline: local sign-out still applies */ }
    }
    safeDel(MODE_KEY);
    this.mode = null; this.user = null; this.state = emptyState();
    this.emit('signout');
  }

  /* ---------- sync ---------- */
  async syncNow({ pull = true } = {}) {
    if (this.mode !== 'cloud') return;
    let SetupRequiredError = class {};
    this.sync.status = 'syncing'; this.emit('sync');
    try {
      const mod = await this.mod();
      const cloud = mod.cloud;
      SetupRequiredError = mod.SetupRequiredError;
      await this.flush(true);
      if (pull) {
        const remote = await cloud.pullAll(this.user.id);
        const remoteEmpty = COLLECTIONS.every(c => remote[c].length === 0);
        const localHas = COLLECTIONS.some(c => this.state[c].length > 0);
        if (remoteEmpty && localHas) {
          // First sync of this account from this device: upload what we have.
          this.queueAll();
          await this.flush(true);
        } else {
          // Remote is the source of truth; re-apply anything still pending locally.
          const pending = new Map(this.outbox.map(o => [`${o.coll}|${o.id || o.row?.id}`, o]));
          for (const c of COLLECTIONS) {
            const rows = remote[c].filter(r => !pending.has(`${c}|${r.id}`));
            for (const o of pending.values()) if (o.coll === c && o.op === 'upsert') rows.push(o.row);
            this.state[c] = rows;
          }
          if (remote.settings && !pending.has('settings|settings')) this.state.settings = { ...emptyState().settings, ...remote.settings };
        }
      }
      this.sync = { status: 'synced', error: null, lastSync: nowISO(), setupRequired: false };
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.sync = {
        status: offline ? 'offline' : 'error',
        error: offline ? 'Offline — changes are saved on this device and will sync later.' : (e.message || String(e)),
        lastSync: this.sync.lastSync,
        setupRequired: e instanceof SetupRequiredError,
      };
    }
    this.persist();
    this.emit('sync');
  }

  queueAll() {
    this.outbox = [{ op: 'upsert', coll: 'settings', id: 'settings', row: this.state.settings }];
    for (const c of COLLECTIONS) for (const r of this.state[c]) this.outbox.push({ op: 'upsert', coll: c, id: r.id, row: r });
  }

  enqueue(op) {
    if (this.mode !== 'cloud') return;
    const key = `${op.coll}|${op.id}`;
    this.outbox = this.outbox.filter(o => `${o.coll}|${o.id}` !== key);
    this.outbox.push(op);
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush().catch(() => {}), 400);
  }

  async flush(throwOnError = false) {
    if (this.mode !== 'cloud' || !this.outbox.length) return;
    const batch = this.outbox.slice();
    try {
      await (await this.mod()).cloud.push(batch, this.user.id);
      const sent = new Set(batch);
      this.outbox = this.outbox.filter(o => !sent.has(o));
      this.sync = { ...this.sync, status: 'synced', error: null, lastSync: nowISO() };
    } catch (e) {
      this.sync = { ...this.sync, status: navigator.onLine === false ? 'offline' : 'error', error: e.message };
      if (throwOnError) throw e;
    } finally {
      this.persist();
      this.emit('sync');
    }
  }

  /* ---------- mutations ---------- */
  upsert(coll, row, { silent = false } = {}) {
    const list = this.state[coll];
    const now = nowISO();
    const i = row.id ? list.findIndex(r => r.id === row.id) : -1;
    let rec;
    if (i >= 0) { rec = { ...list[i], ...row, updatedAt: now }; list[i] = rec; }
    else { rec = { ...row, id: row.id || uuid(), createdAt: row.createdAt || now, updatedAt: now }; list.push(rec); }
    this.enqueue({ op: 'upsert', coll, id: rec.id, row: rec });
    if (!silent) { this.persist(); this.emit('change'); }
    return rec;
  }

  remove(coll, id, { silent = false } = {}) {
    this.state[coll] = this.state[coll].filter(r => r.id !== id);
    this.enqueue({ op: 'delete', coll, id });
    if (!silent) { this.persist(); this.emit('change'); }
  }

  /** Several changes, one save + one re-render. */
  batch(fn) {
    fn({
      upsert: (c, r) => this.upsert(c, r, { silent: true }),
      remove: (c, id) => this.remove(c, id, { silent: true }),
      settings: p => this.updateSettings(p, { silent: true }),
    });
    this.persist(); this.emit('change');
  }

  updateSettings(patch, { silent = false } = {}) {
    this.state.settings = { ...this.state.settings, ...patch, id: 'settings', updatedAt: nowISO() };
    this.enqueue({ op: 'upsert', coll: 'settings', id: 'settings', row: this.state.settings });
    if (!silent) { this.persist(); this.emit('change'); }
  }

  setBalance(cents, date = todayISO()) {
    this.updateSettings({ balanceCents: cents, balanceDate: date, balanceSetAt: nowISO(), demoBalance: false });
  }

  /** Set a category budget. scope 'from' = this month onward; 'only' = just this month. */
  setBudget(categoryId, month, amountCents, scope = 'from') {
    this.batch(tx => {
      for (const b of this.state.budgets.slice()) {
        if (b.categoryId !== categoryId) continue;
        if (b.month === month && (b.scope === scope || scope === 'from')) tx.remove('budgets', b.id);
        else if (scope === 'from' && b.scope !== 'only' && b.month > month) tx.remove('budgets', b.id);
      }
      tx.upsert('budgets', { categoryId, month, amountCents, scope });
    });
  }

  /** Remove a category: transactions and bills move to `reassignTo` (or become uncategorized). */
  deleteCategory(id, reassignTo = null) {
    this.batch(tx => {
      const ids = new Set([id, ...this.state.categories.filter(c => c.parentId === id).map(c => c.id)]);
      for (const t of this.state.transactions) if (ids.has(t.categoryId)) tx.upsert('transactions', { ...t, categoryId: reassignTo });
      for (const b of this.state.bills) if (ids.has(b.categoryId)) tx.upsert('bills', { ...b, categoryId: reassignTo });
      for (const b of this.state.budgets) if (ids.has(b.categoryId)) tx.remove('budgets', b.id);
      for (const cid of ids) tx.remove('categories', cid);
    });
  }

  /** Delete only rows created as sample data. Real entries are untouched. */
  removeDemo() {
    this.batch(tx => {
      for (const c of COLLECTIONS) for (const r of this.state[c].slice()) if (r.isDemo) tx.remove(c, r.id);
      if (this.state.settings.demoBalance) tx.settings({ balanceCents: null, balanceDate: null, balanceSetAt: null, demoBalance: false });
    });
  }
  hasDemo() { return COLLECTIONS.some(c => this.state[c].some(r => r.isDemo)); }

  /** Replace everything (restore from backup). */
  replaceAll(data) {
    this.batch(tx => {
      for (const c of COLLECTIONS) for (const r of this.state[c].slice()) tx.remove(c, r.id);
      for (const c of COLLECTIONS) for (const r of (data[c] || [])) tx.upsert(c, r);
      tx.settings({ ...emptyState().settings, ...(data.settings || {}) });
    });
  }

  wipe() {
    this.batch(tx => {
      for (const c of COLLECTIONS) for (const r of this.state[c].slice()) tx.remove(c, r.id);
      tx.settings({ balanceCents: null, balanceDate: null, balanceSetAt: null, bufferCents: 0, demoBalance: false });
    });
  }
}

export const store = new Store();
export { Store };
