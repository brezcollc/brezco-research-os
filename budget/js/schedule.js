/* schedule.js — turns a recurrence rule into concrete dates.

   Rule shape (shared by income sources and bills):
     frequency:  once | weekly | biweekly | semimonthly | monthly | quarterly |
                 semiannual | annually | custom
     anchorDate: a known occurrence (any past or future payday / due date) — the
                 recurrence extends both directions from it
     startDate:  optional first day the rule applies (nothing earlier is generated)
     dayOfMonth: for monthly-type rules (defaults to the anchor's day; 31 = last day)
     semimonthlyDays: [d1, d2] for semimonthly (31 = last day of month)
     intervalDays: for custom
     weekendAdjust: none | before | after (paydays that land on a weekend)
     endDate: optional last date                                                  */
import { toDayNum, fromDayNum, parts, daysInMonth, weekday, makeDate } from './dates.js';

const MONTH_STEPS = { monthly: 1, quarterly: 3, semiannual: 6, annually: 12 };
const DAY_STEPS = { weekly: 7, biweekly: 14 };

export const FREQ_LABELS = {
  once: 'One time', weekly: 'Weekly', biweekly: 'Every 2 weeks', semimonthly: 'Twice a month',
  monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annually: 'Yearly', custom: 'Custom',
};

/** Average occurrences per year — used for "monthly equivalent" planning figures. */
export function perYear(rule) {
  switch (rule.frequency) {
    case 'weekly': return 52.1775;
    case 'biweekly': return 26.08875;
    case 'semimonthly': return 24;
    case 'monthly': return 12;
    case 'quarterly': return 4;
    case 'semiannual': return 2;
    case 'annually': return 1;
    case 'custom': return rule.intervalDays > 0 ? 365.2425 / rule.intervalDays : 0;
    default: return 0;
  }
}

function adjustWeekend(n, mode) {
  if (!mode || mode === 'none') return n;
  const wd = ((n % 7) + 7 + 4) % 7;
  if (wd === 6) return mode === 'before' ? n - 1 : n + 2; // Saturday
  if (wd === 0) return mode === 'before' ? n - 2 : n + 1; // Sunday
  return n;
}

/** All occurrence dates of `rule` that fall within [from, to] (inclusive), sorted. */
export function occurrences(rule, from, to) {
  if (!rule || !rule.frequency || from > to) return [];
  const pad = rule.weekendAdjust && rule.weekendAdjust !== 'none' ? 3 : 0;
  const f = toDayNum(from), t = toDayNum(to);
  const lo = f - pad, hi = t + pad;
  const anchorN = rule.anchorDate ? toDayNum(rule.anchorDate) : null;
  const startN = rule.startDate ? toDayNum(rule.startDate) : (rule.frequency === 'once' && anchorN !== null ? anchorN : -Infinity);
  const endN = rule.endDate ? toDayNum(rule.endDate) : Infinity;
  const raw = [];
  const freq = rule.frequency;

  if (freq === 'once') {
    if (anchorN !== null) raw.push(anchorN);
  } else if (DAY_STEPS[freq] || freq === 'custom') {
    const step = DAY_STEPS[freq] || Math.max(1, Math.floor(rule.intervalDays || 0));
    if (!rule.anchorDate || !(step > 0)) return [];
    const k = Math.ceil((lo - anchorN) / step);
    for (let n = anchorN + k * step; n <= hi; n += step) raw.push(n);
  } else if (MONTH_STEPS[freq] || freq === 'semimonthly') {
    const step = MONTH_STEPS[freq] || 1;
    const loD = fromDayNum(lo), hiD = fromDayNum(hi);
    const [ly, lm] = parts(loD), [hy, hm] = parts(hiD);
    let anchorIdx = null, anchorDay = null;
    if (rule.anchorDate) { const [ay, am, ad] = parts(rule.anchorDate); anchorIdx = ay * 12 + am - 1; anchorDay = ad; }
    const days = freq === 'semimonthly'
      ? (Array.isArray(rule.semimonthlyDays) && rule.semimonthlyDays.length ? rule.semimonthlyDays : [1, 15])
      : [rule.dayOfMonth || anchorDay || 1];
    for (let idx = ly * 12 + lm - 1; idx <= hy * 12 + hm - 1; idx++) {
      if (anchorIdx !== null && step > 1 && ((idx - anchorIdx) % step + step) % step !== 0) continue;
      const y = Math.floor(idx / 12), m = (idx % 12) + 1;
      for (const d of days) raw.push(toDayNum(makeDate(y, m, Math.min(Number(d), daysInMonth(y, m)))));
    }
  }

  const out = new Set();
  for (const n of raw) {
    if (n < startN || n > endN) continue;
    const a = adjustWeekend(n, rule.weekendAdjust);
    if (a >= f && a <= t) out.add(a);
  }
  return [...out].sort((a, b) => a - b).map(fromDayNum);
}

/** First occurrence on or after `from`, searching up to `horizonDays` ahead. */
export function nextOccurrence(rule, from, horizonDays = 400) {
  const list = occurrences(rule, from, fromDayNum(toDayNum(from) + horizonDays));
  return list[0] || null;
}

export function describeRule(rule) {
  const f = FREQ_LABELS[rule.frequency] || rule.frequency;
  if (rule.frequency === 'custom') return `Every ${rule.intervalDays} days`;
  if (rule.frequency === 'semimonthly') {
    const d = (rule.semimonthlyDays || [1, 15]).map(x => (Number(x) >= 31 ? 'last day' : ordinal(x)));
    return `${f} · ${d.join(' & ')}`;
  }
  if (rule.frequency === 'monthly') {
    const d = rule.dayOfMonth || (rule.anchorDate ? Number(rule.anchorDate.slice(8)) : 1);
    return `${f} · ${d >= 31 ? 'last day' : ordinal(d)}`;
  }
  return f;
}
export function ordinal(n) {
  n = Number(n);
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export { weekday };
