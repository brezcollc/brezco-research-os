/* money.js — all currency is integer cents. Never use floats for stored money.
   Floats appear only for display-side percentages. */

/** Parse user text ("$1,234.5", "12", "-3.99", "(4.00)") into integer cents, or null. */
export function parseMoney(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = input.toFixed(2);
  }
  let s = String(input).trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  let cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1; // round half up at the 3rd decimal
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Exact integer formatting: 123456 -> "$1,234.56". */
export function fmt(cents, opts = {}) {
  const { showCents = true, sign = false } = opts;
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  const c = Math.round(cents);
  const neg = c < 0;
  const abs = Math.abs(c);
  let body;
  if (showCents) body = `$${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
  else body = `$${group(Math.round(abs / 100))}`;
  if (neg) return `−${body}`;
  if (sign && c > 0) return `+${body}`;
  return body;
}

/** Whole dollars when large, cents when small — for compact figures. */
export function fmtSmart(cents, opts = {}) {
  return fmt(cents, { ...opts, showCents: Math.abs(cents) < 100000 && cents % 100 !== 0 });
}

/** Compact axis label: $1.2k, $15k, $1.1M */
export function fmtCompact(cents) {
  const d = Math.abs(cents) / 100;
  const s = cents < 0 ? '−' : '';
  if (d >= 1e6) return `${s}$${(d / 1e6).toFixed(d >= 1e7 ? 0 : 1)}M`;
  if (d >= 1e3) return `${s}$${(d / 1e3).toFixed(d >= 1e4 ? 0 : 1)}k`;
  return `${s}$${Math.round(d)}`;
}

/** Plain decimal string for CSV and form inputs: 123456 -> "1234.56" */
export function toDecimal(cents) {
  if (cents === null || cents === undefined) return '';
  const neg = cents < 0, abs = Math.abs(Math.round(cents));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);

/** Conservative integer division (floors toward zero for allowances). */
export function divFloor(cents, n) {
  if (!n || n <= 0) return 0;
  return cents >= 0 ? Math.floor(cents / n) : -Math.ceil(-cents / n);
}
export function divCeil(cents, n) {
  if (!n || n <= 0) return cents;
  return cents >= 0 ? Math.ceil(cents / n) : -Math.floor(-cents / n);
}

export const pct = (a, b) => (b > 0 ? a / b : (a > 0 ? Infinity : 0));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
