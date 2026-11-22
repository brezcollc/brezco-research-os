/* ctx.js — shared UI state. `today` can be pinned with ?today=YYYY-MM-DD for testing. */
import { todayISO, monthKey, isValidISO } from './dates.js';

let pinned = null;
try {
  const q = new URLSearchParams(location.search).get('today');
  if (isValidISO(q)) pinned = q;
} catch { /* not in a browser */ }

export const today = () => pinned || todayISO();

const mk = monthKey(today());
export const ui = {
  tab: 'dashboard',
  seg: 'spending',
  month: mk,
  calMonth: mk,
  calSel: null,
  tx: { q: '', month: mk, kind: 'all', cat: '' },
  page: null,          // { type: 'category', id, month }
  pageStack: [],
  chartSel: {},
  anKind: 'all',
  showAllInsights: false,
  dismissSetup: false,
  txLimit: 250,
  openDetails: new Set(),
};
