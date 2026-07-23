/* ============================================================
   dataStore.js — data-access abstraction layer
   ------------------------------------------------------------
   ALL reads/writes of research entries and settings go through
   this module. The UI never touches localStorage directly.

   PHASE 1 (now):   localStorage backend, implemented below.
   PHASE 2 (later): swap the `backend` object for one that calls
                    a real API (Supabase / Cloudflare D1). The
                    public interface below is already async
                    (returns Promises) so the UI does not change.

   To migrate: implement an object with the same method
   signatures as `localBackend` that does fetch() calls, then
   set `const backend = apiBackend;`. Nothing in app.js changes.
   ============================================================ */

import { SEED_ENTRIES } from './seed.js';

const KEYS = {
  entries:  'brezco.research.entries.v1',
  settings: 'brezco.research.settings.v1',
  seeded:   'brezco.research.seeded.v1',
};

function uid() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Normalize an arbitrary object into a valid entry shape. */
function normalize(raw) {
  const e = raw || {};
  return {
    id:        e.id || uid(),
    ticker:    String(e.ticker || '').trim().toUpperCase(),
    company:   String(e.company || '').trim(),
    sector:    String(e.sector || '').trim(),
    rating:    normalizeRating(e.rating),
    status:    normalizeStatus(e.status),
    price:     e.price != null ? String(e.price).trim() : '',
    target:    e.target != null ? String(e.target).trim() : '',
    link:      String(e.link || '').trim(),
    date:      String(e.date || '').trim(),
    notes:     String(e.notes || '').trim(),
    livePrice: e.livePrice != null ? String(e.livePrice) : '',
    liveAsOf:  e.liveAsOf || '',
    // Optional. When absent, callers fall back to `date` at render time
    // (no migration write is forced for existing entries / seed data).
    lastReviewed: String(e.lastReviewed || '').trim(),
  };
}

/* ---------------- sector hygiene ----------------
   The canonical sector taxonomy. Sectors that differ only by case,
   punctuation, whitespace, or "and" vs "&" are folded into these on load
   so the sidebar never fragments into duplicates. Genuinely different
   custom sectors are left untouched; blank sectors are routed to a
   clearly-labeled review bucket rather than guessed. */
export const CANONICAL_SECTORS = [
  'AI Infra & Semis',
  'Power & Energy',
  'Defense & Security',
  'Fintech & Consumer',
  'Small-Cap Discovery',
  'Company Deep Dives',
  'Macro & Education',
];
export const REVIEW_SECTOR = 'Needs Sector Review';

/* Normalized comparison key: lowercase, "and"->"&", strip everything but
   alphanumerics and "&". "AI Infra and Semis" === "ai infra & semis". */
function sectorKey(s) {
  return String(s || '').toLowerCase().replace(/\band\b/g, '&').replace(/[^a-z0-9&]/g, '');
}
const CANON_BY_KEY = new Map(CANONICAL_SECTORS.map(s => [sectorKey(s), s]));

/* Clean a single sector value: trim, fold to canonical if it matches one,
   route blank to the review bucket, otherwise keep the trimmed custom name. */
function hygieneSector(s) {
  const trimmed = String(s || '').trim();
  if (!trimmed) return REVIEW_SECTOR;
  return CANON_BY_KEY.get(sectorKey(trimmed)) || trimmed;
}

/* Position status — what Ian actually did, separate from the rating call.
   Missing/unknown -> "Unset" (no migration write forced on existing data). */
function normalizeStatus(s) {
  const v = String(s || 'Unset').trim().toLowerCase();
  const map = { holding: 'Holding', watching: 'Watching', passed: 'Passed', unset: 'Unset' };
  return map[v] || 'Unset';
}

function normalizeRating(r) {
  const v = String(r || 'N/A').trim().toUpperCase();
  return ['BUY', 'HOLD', 'SELL', 'AVOID', 'N/A'].includes(v) ? v : 'N/A';
}

/* ---------- localStorage backend ---------- */
const localBackend = {
  async readAll() {
    try {
      const raw = localStorage.getItem(KEYS.entries);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(normalize) : [];
    } catch {
      return [];
    }
  },
  async writeAll(entries) {
    localStorage.setItem(KEYS.entries, JSON.stringify(entries));
  },
  async readSettings() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.settings) || '{}') || {};
    } catch {
      return {};
    }
  },
  async writeSettings(obj) {
    localStorage.setItem(KEYS.settings, JSON.stringify(obj));
  },
};

// The single point of backend selection. Swap in Phase 2.
const backend = localBackend;

/* ============================================================
   Public API — the only surface app.js is allowed to use.
   ============================================================ */
export const dataStore = {
  /* Seed on first ever load, then run sector hygiene, then return everything. */
  async init() {
    const alreadySeeded = localStorage.getItem(KEYS.seeded);
    const current = await backend.readAll();
    if (!alreadySeeded && current.length === 0) {
      const seeded = SEED_ENTRIES.map(normalize);
      await backend.writeAll(seeded);
      localStorage.setItem(KEYS.seeded, '1');
    }
    // One-time-per-load sector cleanup: folds duplicate spellings to
    // canonical names and routes blank sectors to the review bucket.
    // Applies to whatever is in this browser, including data added earlier.
    return this.runSectorHygiene();
  },

  /* Normalize every entry's sector in place; write back only if something
     changed. Returns { entries, fixed } — fixed lists what was rewritten. */
  async runSectorHygiene() {
    const all = await backend.readAll();
    const fixed = [];
    for (const e of all) {
      const cleaned = hygieneSector(e.sector);
      if (cleaned !== e.sector) {
        fixed.push({ ticker: e.ticker, from: e.sector, to: cleaned });
        e.sector = cleaned;
      }
    }
    if (fixed.length) await backend.writeAll(all);
    this._lastHygiene = fixed;
    return all;
  },

  /* What the most recent hygiene pass changed (for reporting in the UI). */
  lastHygiene() {
    return this._lastHygiene || [];
  },

  /* Rename a sector across every entry that uses it. If newName matches an
     existing sector, this merges them. Returns the count of entries moved. */
  async renameSector(oldName, newName) {
    const target = String(newName || '').trim();
    if (!target) return 0;
    const all = await backend.readAll();
    let count = 0;
    for (const e of all) {
      if ((e.sector || '') === oldName) { e.sector = target; count++; }
    }
    if (count) await backend.writeAll(all);
    return count;
  },

  async getAll() {
    return backend.readAll();
  },

  async get(id) {
    const all = await backend.readAll();
    return all.find(e => e.id === id) || null;
  },

  /* Insert or update a single entry. Returns the saved entry. */
  async upsert(entry) {
    const clean = normalize(entry);
    const all = await backend.readAll();
    const idx = all.findIndex(e => e.id === clean.id);
    if (idx >= 0) all[idx] = clean; else all.push(clean);
    await backend.writeAll(all);
    return clean;
  },

  /* Merge many entries at once (import). Returns saved entries. */
  async bulkUpsert(entries) {
    const all = await backend.readAll();
    const byId = new Map(all.map(e => [e.id, e]));
    const saved = [];
    for (const raw of entries) {
      const clean = normalize(raw);
      byId.set(clean.id, clean);
      saved.push(clean);
    }
    await backend.writeAll([...byId.values()]);
    return saved;
  },

  /* Apply a live price to every entry sharing a ticker. */
  async applyLivePrice(ticker, price, asOf) {
    const all = await backend.readAll();
    const t = String(ticker).toUpperCase();
    let count = 0;
    for (const e of all) {
      if (e.ticker === t) {
        e.livePrice = String(price);
        e.liveAsOf = asOf;
        count++;
      }
    }
    await backend.writeAll(all);
    return count;
  },

  /* Stamp a single entry's lastReviewed date (YYYY-MM-DD). */
  async markReviewed(id, dateStr) {
    const all = await backend.readAll();
    const e = all.find(x => x.id === id);
    if (e) {
      e.lastReviewed = dateStr;
      await backend.writeAll(all);
    }
    return e || null;
  },

  async remove(id) {
    const all = await backend.readAll();
    await backend.writeAll(all.filter(e => e.id !== id));
  },

  /* ---- settings ---- */
  async getSetting(key) {
    const s = await backend.readSettings();
    return s[key];
  },
  async setSetting(key, value) {
    const s = await backend.readSettings();
    s[key] = value;
    await backend.writeSettings(s);
  },
};
