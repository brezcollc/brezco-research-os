/* ============================================================
   dataStore.js — data-access abstraction layer
   ------------------------------------------------------------
   ALL reads/writes of research entries and settings go through
   this module. The UI never touches the database directly.

   Backend: Supabase (one row per report, RLS-scoped to the
   signed-in user). Writes are TARGETED — only the rows/columns
   that changed are sent. The browser never writes live_price /
   live_as_of: those belong to the price feed (scripts/
   update_prices.py), so a stale browser tab can't roll prices
   back, and a save on one device can't delete rows another
   device added.

   Demo mode (localhost only, ?demo=1): an in-memory backend
   with sample data so the UI can be previewed without login.
   ============================================================ */

import { supabase } from './supabase.js?v=20260928a';

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

    /* ---- v3 fields (all optional; older theses simply don't have them) ---- */
    research_stage: ['screen', 'deep_dive', 'update'].includes(str(raw.research_stage).toLowerCase())
      ? str(raw.research_stage).toLowerCase() : '',
    variant_view: str(raw.variant_view),          // what the market is missing
    market_implies: str(raw.market_implies),      // expectations embedded in the price
    key_drivers: arr(raw.key_drivers).map(d => ({
      driver:      str(d && d.driver),
      current:     str(d && d.current),
      sensitivity: str(d && d.sensitivity),
    })).filter(d => d.driver),
    // Accepts Claude's {bull:{…},base:{…},bear:{…}} AND the stored array form,
    // so normalizing an already-normalized thesis (every DB read) is lossless.
    scenarios: ['bull', 'base', 'bear'].map(k => {
      const src = raw.scenarios;
      const s = (Array.isArray(src) ? src.find(x => x && x.case === k) : src && src[k]) || {};
      const p = Number(String(s.probability ?? '').replace('%', ''));
      return {
        case: k,
        target:      str(s.target),
        probability: Number.isFinite(p) && p > 0 ? (p > 1 ? p / 100 : p) : null,
        narrative:   str(s.narrative),
      };
    }).filter(s => s.target || s.narrative),
    risks: arr(raw.risks).map(str).filter(Boolean),
    data_gaps: arr(raw.data_gaps).map(str).filter(Boolean),
    next_review: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.next_review)) ? str(raw.next_review) : '',
  };

  const hasContent = t.one_liner || t.call_type || t.conviction != null ||
    t.assumptions.length || t.thesis_breakers.length || t.catalysts.length ||
    t.watch_next_quarter.length || t.prediction.statement ||
    t.variant_view || t.scenarios.length || t.key_drivers.length;
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
  'Industrials & Infrastructure',
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
   uploaded to the cloud on first login. Never written to afterwards, so it
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

/* Per-device settings (UI preferences) live in localStorage. */
const settingsStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(KEYS.settings) || '{}') || {}; }
    catch { return {}; }
  },
  write(obj) {
    try { localStorage.setItem(KEYS.settings, JSON.stringify(obj)); } catch {}
  },
};

/* ---------- Supabase backend ---------- */
/* DB uses snake_case columns; the app model uses camelCase. Map both ways. */
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

/* The columns the BROWSER owns. live_price / live_as_of are deliberately
   absent: the price feed owns them, and a browser write must never roll them
   back to whatever this tab loaded earlier. */
function entryToRow(e) {
  const c = normalize(e);
  const row = {
    id: c.id, ticker: c.ticker, company: c.company, sector: c.sector,
    rating: c.rating, status: c.status, price: c.price, target: c.target,
    link: c.link, report_date: c.date, notes: c.notes,
    last_reviewed: c.lastReviewed,
    updated_at: new Date().toISOString(),
    // user_id is filled by the table's default auth.uid() on insert.
  };
  if (c.thesis) row.thesis = c.thesis;
  return row;
}

const supabaseBackend = {
  async readAll() {
    const { data, error } = await supabase.from(TABLE).select('*');
    if (error) throw error;
    return (data || []).map(rowToEntry);
  },
  /* Insert-or-update exactly these entries. Rows with and without a thesis
     are sent separately so a batch never nulls out a column a row didn't
     mention. */
  async upsertMany(entries) {
    const rows = entries.map(entryToRow);
    for (const group of [rows.filter(r => r.thesis), rows.filter(r => !r.thesis)]) {
      if (!group.length) continue;
      const { error } = await supabase.from(TABLE).upsert(group, { onConflict: 'id' });
      if (error) throw error;
    }
  },
  async update(id, fields) {
    const { error } = await supabase.from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
  async updateWhere(column, value, fields) {
    const { data, error } = await supabase.from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq(column, value).select('id');
    if (error) throw error;
    return (data || []).length;
  },
  async remove(id) {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};

/* ---------- in-memory demo backend (localhost ?demo=1 only) ---------- */
function memoryBackend(seed) {
  let rows = seed.map(normalize);
  const byId = id => rows.find(r => r.id === id);
  const toModel = f => {
    const m = { ...f };
    if ('last_reviewed' in m) { m.lastReviewed = m.last_reviewed; delete m.last_reviewed; }
    delete m.updated_at;
    return m;
  };
  return {
    async readAll() { return rows.map(r => normalize(JSON.parse(JSON.stringify(r)))); },
    async upsertMany(entries) {
      for (const e of entries) {
        const c = normalize(e);
        const cur = byId(c.id);
        // mimic the real backend: live price fields are feed-owned
        if (cur) Object.assign(cur, { ...c, livePrice: cur.livePrice, liveAsOf: cur.liveAsOf });
        else rows.push(c);
      }
    },
    async update(id, fields) { const r = byId(id); if (r) Object.assign(r, toModel(fields)); },
    async updateWhere(column, value, fields) {
      let n = 0;
      for (const r of rows) if (r[column] === value) { Object.assign(r, toModel(fields)); n++; }
      return n;
    },
    async remove(id) { rows = rows.filter(r => r.id !== id); },
  };
}

export const IS_DEMO = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('demo');

let backend = supabaseBackend;

/* ============================================================
   Auth — magic-link (passwordless) email login.
   ============================================================ */
export const auth = {
  async currentUser() {
    if (IS_DEMO) return { email: 'demo@localhost' };
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
    if (IS_DEMO) return;
    return supabase.auth.onAuthStateChange((_event, session) => cb(session));
  },
};

/* ============================================================
   Public API — the only surface app.js is allowed to use.
   ============================================================ */
export const dataStore = {
  /* Load the signed-in user's rows. On the very first login, if this account
     has no rows yet but this browser has Phase-1 localStorage data, upload it
     so nothing is lost in the move to the cloud. */
  async init() {
    if (IS_DEMO) {
      const { DEMO_ENTRIES } = await import('./demo.js?v=20260928a');
      backend = memoryBackend(DEMO_ENTRIES);
    }
    let current = await backend.readAll();
    if (!IS_DEMO && current.length === 0 && !localStorage.getItem(KEYS.supaMigrated)) {
      const legacy = loadLegacyLocalEntries();
      if (legacy.length) {
        await backend.upsertMany(legacy);
        current = await backend.readAll();
      }
      localStorage.setItem(KEYS.supaMigrated, '1');
    }
    // One-time: retire the "Company Deep Dives" catch-all if any lingered.
    await this.migrateCompanyDeepDives(current);
    // Sector hygiene: fold duplicate spellings to canonical, flag blanks.
    return this.runSectorHygiene();
  },

  /* Retire the "Company Deep Dives" sector. Known tickers -> real industry
     (CDD_REMAP); any other entry still tagged with it -> the review bucket.
     Runs once per browser; writes only the rows it changes. */
  async migrateCompanyDeepDives(all) {
    if (localStorage.getItem(KEYS.cddMigrated)) return { migrated: [] };
    const migrated = [];
    for (const e of all) {
      if ((e.sector || '').trim() === RETIRED_SECTOR) {
        const to = CDD_REMAP[e.ticker] || REVIEW_SECTOR;
        migrated.push({ ticker: e.ticker, to });
        await backend.update(e.id, { sector: to });
      }
    }
    localStorage.setItem(KEYS.cddMigrated, '1');
    return { migrated };
  },

  /* Normalize every entry's sector; write back only the rows that changed. */
  async runSectorHygiene() {
    const all = await backend.readAll();
    const fixed = [];
    for (const e of all) {
      const cleaned = hygieneSector(e.sector);
      if (cleaned !== e.sector) {
        fixed.push({ ticker: e.ticker, from: e.sector, to: cleaned });
        await backend.update(e.id, { sector: cleaned });
        e.sector = cleaned;
      }
    }
    this._lastHygiene = fixed;
    return all;
  },

  /* What the most recent hygiene pass changed (for reporting in the UI). */
  lastHygiene() {
    return this._lastHygiene || [];
  },

  /* Rename a sector across every entry that uses it (merges if newName
     already exists). Returns the count of entries moved. */
  async renameSector(oldName, newName) {
    const target = String(newName || '').trim();
    if (!target) return 0;
    return backend.updateWhere('sector', oldName, { sector: target });
  },

  async getAll() {
    return backend.readAll();
  },

  /* Insert or update a single entry. Returns the saved entry. */
  async upsert(entry) {
    const clean = normalize(entry);
    await backend.upsertMany([clean]);
    return clean;
  },

  /* Insert/update many entries at once (import). Returns saved entries. */
  async bulkUpsert(entries) {
    const clean = entries.map(normalize);
    await backend.upsertMany(clean);
    return clean;
  },

  /* Stamp a single entry's lastReviewed date (YYYY-MM-DD). */
  async markReviewed(id, dateStr) {
    await backend.update(id, { last_reviewed: dateStr });
  },

  /* Set position status on a report row. */
  async setStatus(id, status) {
    await backend.update(id, { status: normalizeStatus(status) });
  },

  async remove(id) {
    await backend.remove(id);
  },

  /* ---- per-device settings ---- */
  async getSetting(key) {
    return settingsStore.read()[key];
  },
  async setSetting(key, value) {
    const s = settingsStore.read();
    s[key] = value;
    settingsStore.write(s);
  },
};
