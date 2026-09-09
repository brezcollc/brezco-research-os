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

import { SEED_ENTRIES } from './seed.js?v=20260908a';
import { supabase } from './supabase.js?v=20260908a';

const KEYS = {
  entries:  'brezco.research.entries.v1',
  settings: 'brezco.research.settings.v1',
  seeded:   'brezco.research.seeded.v1',
  cddMigrated: 'brezco.research.migration.cdd.v1',
  supaMigrated: 'brezco.research.migration.supabase.v1',
};

const TABLE = 'research_entries';

function uid() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Normalize an arbitrary object into a valid entry shape. */
function normalize(raw) {
  const e = raw || {};
  const out = {
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
  // v2 structured thesis (from the thesis-aware earnings prompt). Optional —
  // the key is only attached when a real thesis is present, so pre-v2 entries
  // and flat imports stay exactly as they were.
  const thesis = normalizeThesis(e.thesis);
  if (thesis) out.thesis = thesis;
  return out;
}

/* ---------------- v2 thesis normalization ----------------
   Coerce the `thesis` object from the earnings prompt's JSON into a clean,
   render-safe shape. Every field is defended: missing arrays become [],
   missing strings become '', conviction is clamped 1-5, assumption status is
   folded to intact|watch|broken. Returns undefined when there's nothing
   meaningful to store, so `normalize()` won't attach an empty husk. */
const ASSUMPTION_STATUSES = ['intact', 'watch', 'broken'];

function normalizeThesis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const str = v => (v == null ? '' : String(v).trim());
  const arr = v => (Array.isArray(v) ? v : []);

  const conv = Number(raw.conviction);
  const t = {
    one_liner: str(raw.one_liner),
    call_type: /trade/i.test(str(raw.call_type)) ? 'Trade'
             : /invest/i.test(str(raw.call_type)) ? 'Invest' : '',
    conviction: Number.isFinite(conv) ? Math.min(5, Math.max(1, Math.round(conv))) : null,
    assumptions: arr(raw.assumptions).map(a => ({
      claim:          str(a && a.claim),
      why_it_matters: str(a && a.why_it_matters),
      confirm_if:     str(a && a.confirm_if),
      break_if:       str(a && a.break_if),
      status: ASSUMPTION_STATUSES.includes(str(a && a.status).toLowerCase())
        ? str(a.status).toLowerCase() : 'watch',
    })).filter(a => a.claim),
    thesis_breakers: arr(raw.thesis_breakers).map(str).filter(Boolean),
    catalysts: arr(raw.catalysts).map(c => ({
      event:           str(c && c.event),
      date:            str(c && c.date),
      matters_because: str(c && c.matters_because),
    })).filter(c => c.event),
    watch_next_quarter: arr(raw.watch_next_quarter).map(str).filter(Boolean),
    prediction: {
      statement: str(raw.prediction && raw.prediction.statement),
      by:        str(raw.prediction && raw.prediction.by),
    },
    changes_since_last: arr(raw.changes_since_last).map(str).filter(Boolean),
  };

  const hasContent = t.one_liner || t.call_type || t.conviction != null ||
    t.assumptions.length || t.thesis_breakers.length || t.catalysts.length ||
    t.watch_next_quarter.length || t.prediction.statement;
  return hasContent ? t : undefined;
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
  'Media & Entertainment',
  'Macro & Education',
];
export const REVIEW_SECTOR = 'Needs Sector Review';

/* One-time reclassification: "Company Deep Dives" was a vague catch-all and is
   being retired. Known tickers move to their real industry; anything else in
   that bucket is surfaced for review rather than silently kept or guessed. */
const RETIRED_SECTOR = 'Company Deep Dives';
const CDD_REMAP = {
  PLTR: 'Defense & Security',
  FN:   'AI Infra & Semis',
  NFLX: 'Media & Entertainment',
};

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

/* Read this browser's Phase-1 (localStorage) entries — the migration source
   uploaded to the cloud on first login. Never written to in Phase 2, so it
   also survives as a local backup. */
function loadLegacyLocalEntries() {
  try {
    const raw = localStorage.getItem(KEYS.entries);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
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

/* ---------- Supabase backend (Phase 2) ---------- */
/* DB uses snake_case columns; the app model uses camelCase. Map both ways.
   Settings (Finnhub key, last refresh) stay in localStorage — per-device. */
function rowToEntry(r) {
  return normalize({
    id: r.id, ticker: r.ticker, company: r.company, sector: r.sector,
    rating: r.rating, status: r.status, price: r.price, target: r.target,
    link: r.link, date: r.report_date, notes: r.notes,
    livePrice: r.live_price, liveAsOf: r.live_as_of, lastReviewed: r.last_reviewed,
    // `thesis` is a jsonb column; Supabase returns it already parsed.
    thesis: r.thesis,
  });
}
function entryToRow(e) {
  const c = normalize(e);
  const row = {
    id: c.id, ticker: c.ticker, company: c.company, sector: c.sector,
    rating: c.rating, status: c.status, price: c.price, target: c.target,
    link: c.link, report_date: c.date, notes: c.notes,
    live_price: c.livePrice, live_as_of: c.liveAsOf, last_reviewed: c.lastReviewed,
    updated_at: new Date().toISOString(),
    // user_id is filled by the table's default auth.uid() on insert.
  };
  // Only send the `thesis` key when the entry actually has one. This keeps
  // pre-v2 saves (mark-reviewed, flat edits) from referencing the column at
  // all, so they succeed even before the jsonb column is added; once the
  // column exists, importing a v2 thesis persists it to the cloud.
  if (c.thesis) row.thesis = c.thesis;
  return row;
}

const supabaseBackend = {
  async readAll() {
    const { data, error } = await supabase.from(TABLE).select('*');
    if (error) throw error;
    return (data || []).map(rowToEntry);
  },
  /* Make the user's rows equal to `entries`: upsert all, delete the rest.
     Keeps the exact "replace whole dataset" semantics the rest of the code
     relies on, so every dataStore method works unchanged. */
  async writeAll(entries) {
    const rows = entries.map(entryToRow);
    const keep = new Set(rows.map(r => r.id));

    const { data: existing, error: selErr } = await supabase.from(TABLE).select('id');
    if (selErr) throw selErr;
    const toDelete = (existing || []).map(r => r.id).filter(id => !keep.has(id));

    if (rows.length) {
      const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
    if (toDelete.length) {
      const { error } = await supabase.from(TABLE).delete().in('id', toDelete);
      if (error) throw error;
    }
  },
  // settings remain per-device in localStorage
  readSettings: localBackend.readSettings,
  writeSettings: localBackend.writeSettings,
};

// The single point of backend selection.
const backend = supabaseBackend;

/* ============================================================
   Auth — magic-link (passwordless) email login.
   ============================================================ */
export const auth = {
  async currentUser() {
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
  },
  async sendMagicLink(email) {
    const redirectTo = window.location.origin + window.location.pathname;
    return supabase.auth.signInWithOtp({
      email: String(email).trim(),
      options: { emailRedirectTo: redirectTo },
    });
  },
  async signOut() {
    return supabase.auth.signOut();
  },
  onChange(cb) {
    return supabase.auth.onAuthStateChange((_event, session) => cb(session));
  },
};

/* ============================================================
   Public API — the only surface app.js is allowed to use.
   ============================================================ */
export const dataStore = {
  /* Load the signed-in user's rows. On the very first login, if this account
     has no rows yet but this browser has Phase-1 localStorage data, upload it
     so nothing is lost in the move to the cloud (a brand-new account with no
     local data simply starts empty — import a backup to populate it). */
  async init() {
    let current = await backend.readAll();
    if (current.length === 0 && !localStorage.getItem(KEYS.supaMigrated)) {
      const legacy = loadLegacyLocalEntries();
      if (legacy.length) {
        await backend.writeAll(legacy);
        current = await backend.readAll();
      }
      localStorage.setItem(KEYS.supaMigrated, '1');
    }
    // One-time: retire the "Company Deep Dives" catch-all if any lingered.
    await this.migrateCompanyDeepDives();
    // Sector hygiene: fold duplicate spellings to canonical, flag blanks.
    return this.runSectorHygiene();
  },

  /* Retire the "Company Deep Dives" sector across existing browser data.
     Known tickers -> real industry (CDD_REMAP); any other entry still tagged
     with it -> the review bucket (never silently kept). Runs once per browser. */
  async migrateCompanyDeepDives() {
    if (localStorage.getItem(KEYS.cddMigrated)) return { migrated: [] };
    const all = await backend.readAll();
    const migrated = [];
    for (const e of all) {
      if ((e.sector || '').trim() === RETIRED_SECTOR) {
        const to = CDD_REMAP[e.ticker] || REVIEW_SECTOR;
        migrated.push({ ticker: e.ticker, to });
        e.sector = to;
      }
    }
    if (migrated.length) await backend.writeAll(all);
    localStorage.setItem(KEYS.cddMigrated, '1');
    return { migrated };
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
