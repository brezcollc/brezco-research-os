/* savings.js — shared helpers for the savings-first features. */
import { store } from './store.js';

/**
 * Default "paid on" date for a bill or transfer due on `due`.
 * Use the due date only if that still lowers the balance (it's on/after the day the balance
 * was last set). Otherwise the app treated this money as still in the account, so recording
 * it now must reduce the balance: use today.
 */
export function payDefaultDate(st, due, today) {
  const anchor = st.settings.balanceDate;
  return due > today ? today : (!anchor || due >= anchor ? due : today);
}

/** Goal a scheduled transfer counts toward (stored in settings.prefs so no schema change is needed). */
export function linkGoal(st, billId) {
  return st.settings.prefs?.billGoals?.[billId] || null;
}

/** One-tap: record a scheduled transfer as done. Returns the new transaction. */
export function recordTransfer(st, billId, due, today) {
  const b = st.bills.find(x => x.id === billId);
  if (!b) return null;
  return store.upsert('transactions', {
    kind: 'expense', date: payDefaultDate(st, due, today), amountCents: b.amountCents, categoryId: b.categoryId,
    merchant: b.name, billId: b.id, billDate: due, goalId: linkGoal(st, billId),
  });
}
