/* dates.js — calendar dates are plain 'YYYY-MM-DD' strings and are converted to
   integer day numbers (days since 1970-01-01, UTC) for arithmetic. No time zones,
   no DST bugs: a date is a calendar day, not an instant. */

const pad = n => String(n).padStart(2, '0');

export function toDayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export function fromDayNum(n) {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export const addDays = (iso, n) => fromDayNum(toDayNum(iso) + n);
export const diffDays = (a, b) => toDayNum(b) - toDayNum(a); // b - a
export const parts = iso => iso.split('-').map(Number);
export const dayOf = iso => Number(iso.slice(8, 10));
export const monthKey = iso => iso.slice(0, 7);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
export function daysInMonthKey(mk) { const [y, m] = mk.split('-').map(Number); return daysInMonth(y, m); }
export const monthStart = mk => `${mk}-01`;
export const monthEnd = mk => `${mk}-${pad(daysInMonthKey(mk))}`;
export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
export const monthIndex = mk => { const [y, m] = mk.split('-').map(Number); return y * 12 + (m - 1); };
export const fromMonthIndex = idx => `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export const weekday = iso => ((toDayNum(iso) % 7) + 7 + 4) % 7;
export const clampDay = (y, m, d) => Math.min(d, daysInMonth(y, m));
export const makeDate = (y, m, d) => `${y}-${pad(m)}-${pad(clampDay(y, m, d))}`;

/** Today in the user's local time zone. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export const isValidISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && fromDayNum(toDayNum(s)) === s;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtMonth = (mk, long = true) => { const [y, m] = mk.split('-').map(Number); return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`; };
export const fmtMonthShort = mk => MONTHS[Number(mk.slice(5, 7)) - 1];
export const fmtDate = iso => { const [, m, d] = parts(iso); return `${MONTHS[m - 1]} ${d}`; };
export const fmtDateDow = iso => `${DOW[weekday(iso)]}, ${fmtDate(iso)}`;
export const dowShort = iso => DOW[weekday(iso)];
/** "Today", "in 3 days" — plus the date when the relative word doesn't already show it. */
export function relDayFull(iso, today) {
  const r = relDay(iso, today);
  return r === fmtDate(iso) || Math.abs(diffDays(today, iso)) <= 1 ? r : `${r} · ${fmtDate(iso)}`;
}
export function relDay(iso, today) {
  const d = diffDays(today, iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return `in ${d} days`;
  if (d < -1 && d > -7) return `${-d} days ago`;
  return fmtDate(iso);
}
