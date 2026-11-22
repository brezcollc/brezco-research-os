/* forms.js — every bottom-sheet form. All amounts are parsed to integer cents. */
import { store } from './store.js';
import { ui, today } from './ctx.js';
import { esc, icon, openSheet, closeSheet, sheetHeader, toast, confirmSheet } from './ui.js';
import { parseMoney, toDecimal, fmt } from './money.js';
import { addDays, diffDays, fmtDate, fmtMonth, monthKey, monthStart, isValidISO } from './dates.js';
import { FREQ_LABELS } from './schedule.js';
import { categoryIndex, billOccurrences, incomeOccurrences, computeMonth } from './engine.js';

const S = () => store.state;

/* ---------- field helpers ---------- */
const money = (name, label, cents, opts = {}) => `<label class="field"><span>${label}</span><div class="input-money"><input class="input num" name="${name}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${cents === null || cents === undefined ? '' : toDecimal(cents)}" ${opts.required ? 'required' : ''}></div></label>`;
const text = (name, label, val = '', opts = {}) => `<label class="field"><span>${label}</span><input class="input" name="${name}" value="${esc(val)}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} ${opts.required ? 'required' : ''} autocomplete="off" ${opts.list ? `list="${opts.list}"` : ''}></label>`;
const date = (name, label, val = '', opts = {}) => `<label class="field" ${opts.when ? `data-when="${opts.when}"` : ''}><span>${label}</span><input class="input" type="date" name="${name}" value="${esc(val || '')}" ${opts.required ? 'required' : ''}></label>`;
const select = (name, label, options, val, opts = {}) => `<label class="field" ${opts.when ? `data-when="${opts.when}"` : ''}><span>${label}</span><select class="input" name="${name}">${options.map(o => Array.isArray(o) ? `<option value="${esc(o[0])}" ${String(o[0]) === String(val ?? '') ? 'selected' : ''}>${esc(o[1])}</option>` : o).join('')}</select></label>`;
const check = (name, label, on) => `<label class="check"><span>${label}</span><input type="checkbox" name="${name}" ${on ? 'checked' : ''}></label>`;
const dayOptions = [...Array.from({ length: 30 }, (_, i) => [i + 1, String(i + 1)]), [31, 'Last day of month']];
const footer = (label = 'Save', extra = '') => `<div class="foot"><div class="form-err" data-err></div><div class="btn-row">${extra}<button type="submit" class="btn primary">${label}</button></div></div>`;

function formSheet(html, onSubmit, { onMount } = {}) {
  return openSheet(`<form novalidate>${html}</form>`, {
    onMount: sh => {
      const form = sh.querySelector('form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = form.querySelector('[data-err]');
        try {
          const res = await onSubmit(new FormData(form), form);
          if (res !== false) closeSheet();
        } catch (ex) { if (err) err.textContent = ex.message || String(ex); }
      });
      // frequency-dependent fields
      const sync = () => {
        const f = form.querySelector('[name="frequency"]')?.value;
        form.querySelectorAll('[data-when]').forEach(el => el.classList.toggle('hidden', !el.dataset.when.split(' ').includes(f)));
      };
      form.querySelector('[name="frequency"]')?.addEventListener('change', sync);
      sync();
      onMount?.(sh, form);
    },
  });
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const cents = (fd, name, { required = true, allowZero = false } = {}) => {
  const raw = String(fd.get(name) ?? '').trim();
  if (!raw && !required) return null;
  const c = parseMoney(raw);
  need(c !== null, 'Enter a valid amount.');
  need(allowZero ? c >= 0 : c > 0, allowZero ? 'Amount can’t be negative.' : 'Amount must be more than $0.');
  return c;
};
const nonEmpty = v => (v === '' || v === null || v === undefined ? null : v);

/* ====================================================================== */
/* TRANSACTION (quick add / edit)                                         */
/* ====================================================================== */
export function openTxForm(opts = {}) {
  const st = S(), idx = categoryIndex(st), t = today();
  const ex = opts.id ? st.transactions.find(x => x.id === opts.id) : null;
  const optCat = opts.cat ? idx.byId.get(opts.cat) : null;
  const kindOfCat = id => idx.kindOf(id);
  const f = {
    kind: ex ? (ex.kind === 'income' ? 'income' : kindOfCat(ex.categoryId) === 'savings' ? 'savings' : 'expense')
      : (opts.kind || (optCat && kindOfCat(optCat.id) === 'savings' ? 'savings' : 'expense')),
    refund: ex ? ex.kind === 'expense' && ex.amountCents < 0 : false,
    categoryId: ex?.categoryId || opts.cat || null,
    catTouched: !!(ex || opts.cat),
    date: ex?.date || opts.date || t,
    billKey: ex?.billId ? `${ex.billId}|${ex.billDate}` : opts.billId ? `${opts.billId}|${opts.billDate}` : null,
    billTouched: !!(ex || opts.billId),
    sourceId: ex?.incomeSourceId || opts.sourceId || '',
    incomeKey: ex?.incomeSourceId && ex.incomeDate ? `${ex.incomeSourceId}|${ex.incomeDate}` : null,
    incomeTouched: !!ex,
    goalId: ex?.goalId || opts.goalId || '',
    showAll: false,
  };
  if (f.kind === 'savings' && !f.categoryId) f.categoryId = idx.roots.find(c => c.kind === 'savings' && !c.archived)?.id || null;

  // usage ranking for category chips (last 90 days)
  const since = addDays(t, -90), usage = new Map();
  for (const x of st.transactions) if (x.kind === 'expense' && x.date >= since && x.categoryId) usage.set(x.categoryId, (usage.get(x.categoryId) || 0) + 1);
  const merchants = new Map();
  for (const x of st.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) if (x.merchant) merchants.set(x.merchant.toLowerCase(), { name: x.merchant, categoryId: x.categoryId, kind: x.kind });
  let formEl = null;
  const amountVal = ex ? toDecimal(Math.abs(ex.amountCents)) : opts.amountCents ? toDecimal(opts.amountCents) : '';

  const html = `${sheetHeader(ex ? 'Edit transaction' : 'Add transaction')}
    <div class="toggle" data-kind-toggle style="margin-bottom:14px">
      <button type="button" data-k="expense" class="${f.kind === 'expense' ? 'on exp' : ''}">Expense</button>
      <button type="button" data-k="income" class="${f.kind === 'income' ? 'on inc' : ''}">Income</button>
      <button type="button" data-k="savings" class="${f.kind === 'savings' ? 'on sav' : ''}">To savings</button>
    </div>
    <div class="amount-entry"><div class="wrap"><span class="cur">$</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${amountVal}" aria-label="Amount"></div></div>
    <label class="field"><span>Merchant / description</span><input class="input" name="merchant" list="merchant-list" autocomplete="off" placeholder="e.g. Trader Joe's" value="${esc(ex?.merchant || opts.merchant || '')}"></label>
    <datalist id="merchant-list">${[...merchants.values()].slice(-200).map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
    <div data-dyn></div>
    <span class="field-label">Date</span>
    <div class="date-chips"><button type="button" data-date="${t}">Today</button><button type="button" data-date="${addDays(t, -1)}">Yesterday</button><input class="input" type="date" name="date" value="${f.date}" aria-label="Date"></div>
    <label class="field"><span>Notes (optional)</span><input class="input" name="notes" autocomplete="off" value="${esc(ex?.notes || '')}"></label>
    ${footer(ex ? 'Save changes' : 'Add', ex ? `<button type="button" class="btn danger" data-del style="flex:0 0 auto">${icon('trash')}</button>` : '')}`;

  formSheet(html, (fd) => {
    const c = parseMoney(String(fd.get('amount') || ''));
    need(c !== null && c > 0, 'Enter an amount.');
    const d = String(fd.get('date') || '');
    need(isValidISO(d), 'Pick a date.');
    const row = {
      id: ex?.id, date: d, merchant: String(fd.get('merchant') || '').trim() || null, notes: String(fd.get('notes') || '').trim() || null,
      categoryId: null, billId: null, billDate: null, incomeSourceId: null, incomeDate: null, goalId: null,
    };
    if (f.kind === 'income') {
      row.kind = 'income'; row.amountCents = c;
      row.incomeSourceId = f.sourceId || null;
      const key = currentIncomeKey();
      if (key) { const [sid, idate] = key.split('|'); row.incomeSourceId = sid; row.incomeDate = idate; }
    } else {
      need(f.categoryId, 'Choose a category.');
      row.kind = 'expense'; row.categoryId = f.categoryId;
      row.amountCents = f.kind === 'expense' && f.refund ? -c : c;
      if (f.kind === 'savings') row.goalId = f.goalId || null;
      const key = f.kind === 'expense' && !f.refund ? currentBillKey() : null;
      if (key) { const [bid, bdate] = key.split('|'); row.billId = bid; row.billDate = bdate; }
    }
    const before = ex ? { ...ex } : null;
    const saved = store.upsert('transactions', row);
    const label = row.kind === 'income' ? `+${fmt(c)}` : `${idx.byId.get(row.categoryId)?.name || ''} ${fmt(-row.amountCents)}`;
    toast(`${ex ? 'Updated' : 'Added'} · ${label}`, {
      action: 'Undo', onAction: () => { if (before) store.upsert('transactions', before); else store.remove('transactions', saved.id); },
    });
  }, {
    onMount: (sheet, form) => {
      formEl = form;
      const amt = form.querySelector('[name="amount"]');
      const sizeAmt = () => { amt.style.width = `${Math.max(4, (amt.value || '0.00').length + 0.6)}ch`; };
      amt.addEventListener('input', () => { amt.value = amt.value.replace(/[^\d.,]/g, ''); sizeAmt(); if (!f.billTouched) renderDyn(); });
      sizeAmt();
      if (!ex) setTimeout(() => amt.focus(), 30);
      const dateInput = form.querySelector('[name="date"]');
      const syncDate = () => form.querySelectorAll('.date-chips [data-date]').forEach(b => b.classList.toggle('on', b.dataset.date === dateInput.value));
      form.querySelectorAll('.date-chips [data-date]').forEach(b => b.addEventListener('click', () => { dateInput.value = b.dataset.date; f.date = b.dataset.date; syncDate(); renderDyn(); }));
      dateInput.addEventListener('change', () => { f.date = dateInput.value; syncDate(); renderDyn(); });
      syncDate();
      form.querySelectorAll('[data-kind-toggle] button').forEach(b => b.addEventListener('click', () => {
        f.kind = b.dataset.k;
        form.querySelectorAll('[data-kind-toggle] button').forEach(x => { x.className = x === b ? `on ${{ expense: 'exp', income: 'inc', savings: 'sav' }[x.dataset.k]}` : ''; });
        if (f.kind === 'savings' && kindOfCat(f.categoryId) !== 'savings') f.categoryId = idx.roots.find(c => c.kind === 'savings' && !c.archived)?.id || null;
        if (f.kind === 'expense' && kindOfCat(f.categoryId) === 'savings') { f.categoryId = null; f.catTouched = false; }
        renderDyn();
      }));
      form.querySelector('[name="merchant"]').addEventListener('input', e => {
        const m = merchants.get(e.target.value.trim().toLowerCase());
        if (m && !f.catTouched && m.kind === 'expense' && m.categoryId && idx.byId.has(m.categoryId) && f.kind === 'expense') { f.categoryId = m.categoryId; renderDyn(); }
      });
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Delete transaction?', body: 'This updates all your totals immediately.', ok: 'Delete', danger: true });
        if (!ok) return;
        const copy = { ...ex };
        store.remove('transactions', ex.id);
        closeSheet();
        toast('Transaction deleted', { action: 'Undo', onAction: () => store.upsert('transactions', copy) });
      });
      renderDyn();

      function renderDyn() {
        const dyn = form.querySelector('[data-dyn]');
        let h = '';
        if (f.kind === 'income') {
          const srcs = st.incomeSources;
          h += select('sourceId', 'Income source', [['', 'Other / not scheduled'], ...srcs.map(s => [s.id, s.name])], f.sourceId);
          const cands = incomeCandidates();
          if (cands.length) {
            const cur = currentIncomeKey();
            h += select('incomeKey', 'Matches expected payment', [['', 'Not a scheduled payment'], ...cands.map(o => [`${o.sourceId}|${o.date}`, `${o.name} — ${fmtDate(o.date)} · ${fmt(o.expectedCents)}`])], cur);
          }
        } else if (f.kind === 'savings') {
          const savs = idx.roots.filter(c => c.kind === 'savings' && !c.archived);
          if (savs.length > 1) h += select('savCat', 'Savings account', savs.map(c => [c.id, `${c.icon || ''} ${c.name}`]), f.categoryId);
          if (!savs.length) h += `<div class="banner warn">Create a savings category first (Settings → Categories).</div>`;
          const goals = st.goals.filter(g => !g.archived && g.kind === 'target');
          h += select('goalId', 'Toward goal', [['', 'No specific goal'], ...goals.map(g => [g.id, `${g.icon || '🎯'} ${g.name}`])], f.goalId);
        } else {
          h += catGrid();
          const bills = billCandidates();
          if (bills.length) {
            const cur = currentBillKey();
            h += select('billKey', 'Pays a scheduled bill?', [['', 'No — one-off expense'], ...bills.map(o => [`${o.billId}|${o.date}`, `${o.name} — due ${fmtDate(o.date)} · ${fmt(o.amountCents)}`])], cur);
          }
          h += `<label class="check"><span>This is a refund / money back</span><input type="checkbox" name="refund" ${f.refund ? 'checked' : ''}></label>`;
        }
        dyn.innerHTML = h;
        dyn.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { f.categoryId = b.dataset.cat; f.catTouched = true; f.billTouched = false; renderDyn(); }));
        dyn.querySelector('[data-more]')?.addEventListener('click', () => { f.showAll = !f.showAll; renderDyn(); });
        dyn.querySelector('[name="billKey"]')?.addEventListener('change', e => { f.billKey = e.target.value || ''; f.billTouched = true; const o = billCandidates().find(x => `${x.billId}|${x.date}` === e.target.value); if (o && !amt.value) { amt.value = toDecimal(o.amountCents); sizeAmt(); } });
        dyn.querySelector('[name="incomeKey"]')?.addEventListener('change', e => { f.incomeKey = e.target.value || ''; f.incomeTouched = true; });
        dyn.querySelector('[name="sourceId"]')?.addEventListener('change', e => {
          f.sourceId = e.target.value; f.incomeTouched = false;
          const s = st.incomeSources.find(x => x.id === f.sourceId);
          if (s && !amt.value) { amt.value = toDecimal(s.amountCents); sizeAmt(); }
          renderDyn();
        });
        dyn.querySelector('[name="goalId"]')?.addEventListener('change', e => { f.goalId = e.target.value; });
        dyn.querySelector('[name="savCat"]')?.addEventListener('change', e => { f.categoryId = e.target.value; });
        dyn.querySelector('[name="refund"]')?.addEventListener('change', e => { f.refund = e.target.checked; });
      }

      function catGrid() {
        const all = st.categories.filter(c => !c.archived && kindOfCat(c.id) !== 'savings');
        const fixedLast = c => (kindOfCat(c.id) === 'fixed' ? 1 : 0);
        const ranked = all.slice().sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || fixedLast(a) - fixedLast(b) || (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || (a.sort ?? 0) - (b.sort ?? 0));
        let show = f.showAll ? ranked : ranked.filter(c => !c.parentId || usage.get(c.id)).slice(0, 11);
        if (f.categoryId && !show.some(c => c.id === f.categoryId)) { const sel = idx.byId.get(f.categoryId); if (sel) show = [sel, ...show.slice(0, 10)]; }
        return `<span class="field-label">Category</span><div class="cat-grid">${show.map(c => `<button type="button" data-cat="${c.id}" class="${c.id === f.categoryId ? 'on' : ''} ${c.parentId ? 'sub' : ''}"><span class="e">${esc(c.icon || '•')}</span><span>${esc(c.name)}</span></button>`).join('')}
          ${ranked.length > show.length || f.showAll ? `<button type="button" data-more><span class="e">${f.showAll ? '−' : '⋯'}</span><span>${f.showAll ? 'Less' : 'More'}</span></button>` : ''}</div>`;
      }
    },
  });

  function billCandidates() {
    if (!f.categoryId) return [];
    const root = idx.root(f.categoryId)?.id;
    const d = f.date && isValidISO(f.date) ? f.date : t;
    const occ = billOccurrences(st, addDays(d, -45), addDays(d, 31)).filter(o => idx.root(o.categoryId)?.id === root);
    return occ.filter(o => !o.paid || (ex && o.tx?.id === ex.id));
  }
  function currentBillKey() {
    const cands = billCandidates();
    if (f.billTouched) return f.billKey && cands.some(o => `${o.billId}|${o.date}` === f.billKey) ? f.billKey : (f.billKey || '');
    // Auto-match: closest due date whose amount is within 25% of what was typed.
    const amt = parseMoney(formEl?.querySelector('[name="amount"]')?.value || '');
    const d = f.date && isValidISO(f.date) ? f.date : t;
    const ok = cands.filter(o => amt && Math.abs(amt - o.amountCents) <= o.amountCents * 0.25);
    ok.sort((a, b) => Math.abs(diffDays(a.date, d)) - Math.abs(diffDays(b.date, d)));
    return ok[0] ? `${ok[0].billId}|${ok[0].date}` : '';
  }
  function incomeCandidates() {
    const d = f.date && isValidISO(f.date) ? f.date : t;
    return incomeOccurrences(st, addDays(d, -21), addDays(d, 21))
      .filter(o => (!f.sourceId || o.sourceId === f.sourceId) && (!o.received || (ex && o.tx?.id === ex.id)));
  }
  function currentIncomeKey() {
    if (f.incomeTouched || f.incomeKey) return f.incomeKey || '';
    if (!f.sourceId) return '';
    const d = f.date && isValidISO(f.date) ? f.date : t;
    const c = incomeCandidates().sort((a, b) => Math.abs(diffDays(a.date, d)) - Math.abs(diffDays(b.date, d)));
    return c[0] ? `${c[0].sourceId}|${c[0].date}` : '';
  }
}

/* ====================================================================== */
/* INCOME                                                                 */
/* ====================================================================== */
export function openIncomeForm(id) {
  const st = S(), t = today();
  const s = id ? st.incomeSources.find(x => x.id === id) : null;
  const freqs = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'custom', 'once'].map(k => [k, FREQ_LABELS[k]]);
  const sd = s?.semimonthlyDays || [15, 31];
  const html = `${sheetHeader(s ? 'Edit income' : 'Add income')}
    ${text('name', 'Name', s?.name || '', { placeholder: 'e.g. Paycheck — Employer', required: true })}
    ${select('kind', 'Type', [['paycheck', 'Paycheck'], ['side', 'Side income'], ['bonus', 'Bonus'], ['other', 'Other']], s?.kind || 'paycheck')}
    ${money('amount', 'Take-home amount (after taxes)', s?.amountCents ?? null, { required: true })}
    ${select('frequency', 'How often', freqs, s?.frequency || 'biweekly')}
    ${date('anchorDate', 'A recent or upcoming payday', s?.anchorDate || t, { when: 'weekly biweekly custom' })}
    ${date('onceDate', 'Date expected', s?.frequency === 'once' ? s.anchorDate : t, { when: 'once' })}
    <label class="field" data-when="custom"><span>Every how many days?</span><input class="input" name="intervalDays" inputmode="numeric" value="${s?.intervalDays || 14}"></label>
    ${select('dayOfMonth', 'Payday', dayOptions, s?.dayOfMonth || 1, { when: 'monthly' })}
    <div class="row2" data-when="semimonthly">${select('semi1', 'First payday', dayOptions, sd[0])}${select('semi2', 'Second payday', dayOptions, sd[1])}</div>
    ${select('weekendAdjust', 'If payday falls on a weekend', [['none', 'Keep the date'], ['before', 'Paid the Friday before'], ['after', 'Paid the Monday after']], s?.weekendAdjust || 'none', { when: 'weekly biweekly semimonthly monthly custom' })}
    <div class="row2" data-when="weekly biweekly semimonthly monthly custom">${date('startDate', 'Starts (optional)', s ? s.startDate : monthStart(monthKey(t)))}${date('endDate', 'Ends (optional)', s?.endDate || '')}</div>
    ${s ? check('active', 'Active', s.active !== false) : ''}
    <p class="hint">Expected pay is shown separately and never counted as money you have until you confirm it arrived.</p>
    ${footer(s ? 'Save' : 'Add income', s ? `<button type="button" class="btn danger" data-del style="flex:0 0 auto">${icon('trash')}</button>` : '')}`;
  formSheet(html, fd => {
    const name = String(fd.get('name') || '').trim();
    need(name, 'Give it a name.');
    const freq = String(fd.get('frequency'));
    const row = {
      id: s?.id, name, kind: String(fd.get('kind')), amountCents: cents(fd, 'amount'), frequency: freq,
      anchorDate: null, dayOfMonth: null, semimonthlyDays: null, intervalDays: null,
      weekendAdjust: freq === 'once' ? 'none' : String(fd.get('weekendAdjust') || 'none'),
      startDate: freq === 'once' ? null : nonEmpty(fd.get('startDate')), endDate: freq === 'once' ? null : nonEmpty(fd.get('endDate')),
      active: s ? fd.get('active') === 'on' : true,
    };
    if (['weekly', 'biweekly', 'custom'].includes(freq)) { row.anchorDate = String(fd.get('anchorDate')); need(isValidISO(row.anchorDate), 'Pick a payday date.'); }
    if (freq === 'custom') { row.intervalDays = parseInt(fd.get('intervalDays'), 10); need(row.intervalDays > 0 && row.intervalDays < 400, 'Enter a number of days.'); }
    if (freq === 'monthly') { row.dayOfMonth = Number(fd.get('dayOfMonth')); row.anchorDate = row.startDate || monthStart(monthKey(t)); }
    if (freq === 'semimonthly') { row.semimonthlyDays = [Number(fd.get('semi1')), Number(fd.get('semi2'))].sort((a, b) => a - b); need(row.semimonthlyDays[0] !== row.semimonthlyDays[1], 'Pick two different days.'); row.anchorDate = row.startDate || monthStart(monthKey(t)); }
    if (freq === 'once') { row.anchorDate = String(fd.get('onceDate')); need(isValidISO(row.anchorDate), 'Pick a date.'); }
    if (row.startDate && row.endDate) need(row.endDate >= row.startDate, 'End date is before the start date.');
    store.upsert('incomeSources', row);
    toast(s ? 'Income updated' : 'Income added');
  }, {
    onMount: (sh, form) => form.querySelector('[data-del]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: `Delete “${esc(s.name)}”?`, body: 'Future expected payments disappear. Income you already recorded stays in your history.', ok: 'Delete', danger: true });
      if (ok) { store.remove('incomeSources', s.id); closeSheet(); toast('Income source deleted'); }
    }),
  });
}

/** Confirm an expected payment arrived. */
export function openReceiveIncome(sourceId, d) {
  const st = S(), t = today();
  const src = st.incomeSources.find(x => x.id === sourceId);
  if (!src) return;
  const html = `${sheetHeader('Confirm income')}
    <p class="muted" style="margin:-4px 0 16px">${esc(src.name)} · expected ${fmtDate(d)} · ${fmt(src.amountCents)}</p>
    ${money('amount', 'Amount that actually arrived', src.amountCents, { required: true })}
    ${date('date', 'Date received', d <= t ? d : t, { required: true })}
    <p class="hint">Once confirmed, it's added to your actual balance and month totals.</p>
    ${footer('Confirm received')}`;
  formSheet(html, fd => {
    const dt = String(fd.get('date'));
    need(isValidISO(dt), 'Pick a date.');
    store.upsert('transactions', { kind: 'income', date: dt, amountCents: cents(fd, 'amount'), incomeSourceId: src.id, incomeDate: d, merchant: src.name, categoryId: null });
    toast(`Received ${fmt(cents(fd, 'amount'))}`);
  });
}

/* ====================================================================== */
/* BILLS                                                                  */
/* ====================================================================== */
export function openBillForm(id) {
  const st = S(), t = today(), idx = categoryIndex(st);
  const b = id ? st.bills.find(x => x.id === id) : null;
  const fixedCats = st.categories.filter(c => !c.archived && idx.kindOf(c.id) === 'fixed');
  const otherCats = st.categories.filter(c => !c.archived && idx.kindOf(c.id) === 'variable');
  const catOpts = [
    `<optgroup label="Fixed">${fixedCats.map(c => `<option value="${c.id}" ${b?.categoryId === c.id ? 'selected' : ''}>${esc((c.parentId ? '  ↳ ' : '') + c.name)}</option>`).join('')}</optgroup>`,
    `<optgroup label="Other">${otherCats.map(c => `<option value="${c.id}" ${b?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`,
  ];
  const freqs = ['monthly', 'weekly', 'biweekly', 'quarterly', 'semiannual', 'annually', 'custom', 'once'].map(k => [k, FREQ_LABELS[k]]);
  const html = `${sheetHeader(b ? 'Edit bill' : 'Add recurring bill')}
    ${text('name', 'Name', b?.name || '', { placeholder: 'e.g. Rent, Netflix, Car insurance', required: true })}
    ${money('amount', 'Amount', b?.amountCents ?? null, { required: true })}
    ${select('categoryId', 'Category', catOpts, b?.categoryId)}
    ${select('frequency', 'How often', freqs, b?.frequency || 'monthly')}
    ${select('dayOfMonth', 'Due on', dayOptions, b?.dayOfMonth || (b?.anchorDate ? Number(b.anchorDate.slice(8)) : 1), { when: 'monthly' })}
    ${date('anchorDate', 'Next due date', b?.anchorDate || t, { when: 'weekly biweekly quarterly semiannual annually custom once' })}
    <label class="field" data-when="custom"><span>Every how many days?</span><input class="input" name="intervalDays" inputmode="numeric" value="${b?.intervalDays || 30}"></label>
    ${check('autopay', 'Autopay', b?.autopay)}
    <div class="row2" data-when="weekly biweekly monthly quarterly semiannual annually custom">${date('startDate', 'Tracking starts', b ? b.startDate : monthStart(monthKey(t)))}${date('endDate', 'Ends (optional)', b?.endDate || '')}</div>
    ${b ? check('active', 'Active', b.active !== false) : ''}
    ${text('notes', 'Notes (optional)', b?.notes || '')}
    <p class="hint">Unpaid bills are treated as committed money — they come out of “safe to spend” before their due date.</p>
    ${footer(b ? 'Save' : 'Add bill', b ? `<button type="button" class="btn danger" data-del style="flex:0 0 auto">${icon('trash')}</button>` : '')}`;
  formSheet(html, fd => {
    const name = String(fd.get('name') || '').trim();
    need(name, 'Give the bill a name.');
    const freq = String(fd.get('frequency'));
    const row = {
      id: b?.id, name, amountCents: cents(fd, 'amount'), categoryId: String(fd.get('categoryId') || '') || null, frequency: freq,
      anchorDate: null, dayOfMonth: null, intervalDays: null, autopay: fd.get('autopay') === 'on',
      startDate: freq === 'once' ? null : nonEmpty(fd.get('startDate')), endDate: freq === 'once' ? null : nonEmpty(fd.get('endDate')),
      active: b ? fd.get('active') === 'on' : true, notes: String(fd.get('notes') || '').trim() || null,
    };
    if (freq === 'monthly') { row.dayOfMonth = Number(fd.get('dayOfMonth')); row.anchorDate = row.startDate || monthStart(monthKey(t)); }
    else { row.anchorDate = String(fd.get('anchorDate')); need(isValidISO(row.anchorDate), 'Pick the next due date.'); }
    if (['quarterly', 'semiannual', 'annually'].includes(freq)) row.dayOfMonth = Number(row.anchorDate.slice(8));
    if (freq === 'custom') { row.intervalDays = parseInt(fd.get('intervalDays'), 10); need(row.intervalDays > 0, 'Enter a number of days.'); }
    if (row.startDate && row.anchorDate && row.startDate > row.anchorDate && freq !== 'monthly') row.startDate = null;
    store.upsert('bills', row);
    toast(b ? 'Bill updated' : 'Bill added');
  }, {
    onMount: (sh, form) => form.querySelector('[data-del]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: `Delete “${esc(b.name)}”?`, body: 'Upcoming payments are removed. Payments you already logged stay in your history.', ok: 'Delete', danger: true });
      if (ok) { store.remove('bills', b.id); closeSheet(); toast('Bill deleted'); }
    }),
  });
}

/** Mark one bill occurrence as paid. */
export function openPayBill(billId, due) {
  const st = S(), t = today();
  const b = st.bills.find(x => x.id === billId);
  if (!b) return;
  const html = `${sheetHeader(`Pay ${b.name}`)}
    <p class="muted" style="margin:-4px 0 16px">Due ${fmtDate(due)} · scheduled ${fmt(b.amountCents)}</p>
    ${money('amount', 'Amount paid', b.amountCents, { required: true })}
    ${date('date', 'Paid on', due <= t ? due : t, { required: true })}
    <p class="hint">If the money left your account after you last updated your balance, use that later date so your balance drops correctly.</p>
    ${footer('Mark as paid')}`;
  formSheet(html, fd => {
    const dt = String(fd.get('date'));
    need(isValidISO(dt), 'Pick a date.');
    const c = cents(fd, 'amount');
    store.upsert('transactions', { kind: 'expense', date: dt, amountCents: c, categoryId: b.categoryId, merchant: b.name, billId: b.id, billDate: due });
    toast(`${b.name} paid · ${fmt(c)}`);
  });
}

/* ====================================================================== */
/* CATEGORIES & BUDGETS                                                   */
/* ====================================================================== */
const EMOJI = ['🛒', '🍽️', '☕', '🍸', '🛍️', '🎬', '🚕', '✈️', '📦', '🏠', '💡', '🌐', '📱', '🛡️', '🔁', '💳', '🚗', '⛽', '🏋️', '💊', '🐶', '👶', '🎁', '📚', '💇', '🎮', '🎵', '🏥', '🧾', '🏦', '📈', '🎓'];
const COLORS = ['#34d399', '#2dd4bf', '#38bdf8', '#60a5fa', '#7c9cff', '#a78bfa', '#c084fc', '#f472b6', '#fb7185', '#f87171', '#fb923c', '#facc15', '#a3e635', '#94a3b8'];

export function openCategoryForm(id, { parentId = null } = {}) {
  const st = S(), idx = categoryIndex(st), mk = ui.month;
  const c = id ? idx.byId.get(id) : null;
  const parent = c?.parentId ? idx.byId.get(c.parentId) : parentId ? idx.byId.get(parentId) : null;
  const f = { kind: parent ? idx.kindOf(parent.id) : c?.kind || 'variable', icon: c?.icon || parent?.icon || '📦', color: c?.color || parent?.color || COLORS[(st.categories.length * 3) % COLORS.length] };
  const isRoot = !parent;
  const curBudget = c && isRoot ? computeBudget(c.id, mk) : 0;
  const hasChildren = c ? idx.children(c.id).length > 0 : false;
  const html = `${sheetHeader(c ? 'Edit category' : parent ? `New subcategory of ${parent.name}` : 'New category')}
    ${text('name', 'Name', c?.name || '', { required: true, placeholder: 'e.g. Coffee, Pets, Gym' })}
    ${isRoot ? `<span class="field-label">Type</span><div class="toggle" data-kind style="margin-bottom:6px">
      ${[['variable', 'Discretionary'], ['fixed', 'Fixed / bills'], ['savings', 'Savings']].map(([k, l]) => `<button type="button" data-k="${k}" class="${f.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="hint" style="margin-top:6px" data-kind-hint></p>` : ''}
    ${!c && !parent ? '' : (!hasChildren && c ? select('parentId', 'Subcategory of', [['', '— Top-level category —'], ...idx.roots.filter(r => r.id !== c?.id && !r.archived).map(r => [r.id, `${r.icon || ''} ${r.name}`])], parent?.id || '') : '')}
    <span class="field-label">Icon</span><div class="emoji-pick" data-emoji>${EMOJI.map(e => `<button type="button" data-e="${e}" class="${e === f.icon ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label class="field"><span>…or type any emoji</span><input class="input" name="iconCustom" maxlength="4" value="${EMOJI.includes(f.icon) ? '' : esc(f.icon)}"></label>
    <span class="field-label">Color</span><div class="swatches" data-colors>${COLORS.map(x => `<button type="button" data-c="${x}" style="background:${x}" class="${x === f.color ? 'on' : ''}" aria-label="${x}"></button>`).join('')}</div>
    <div data-budget>${isRoot ? `${money('budget', `Monthly budget (${fmtMonth(mk)})`, c ? curBudget : null)}
      ${select('scope', 'Apply budget', [['from', `${fmtMonth(mk)} and every month after`], ['only', `Only ${fmtMonth(mk)}`]], 'from')}` : ''}</div>
    ${c ? check('archived', 'Hide from pickers (keeps history)', c.archived) : ''}
    ${footer(c ? 'Save' : 'Create', c ? `<button type="button" class="btn danger" data-del style="flex:0 0 auto">${icon('trash')}</button>` : '')}`;
  formSheet(html, fd => {
    const name = String(fd.get('name') || '').trim();
    need(name, 'Name the category.');
    const custom = String(fd.get('iconCustom') || '').trim();
    const newParent = fd.has('parentId') ? (String(fd.get('parentId')) || null) : (parent?.id || null);
    const kind = newParent ? idx.kindOf(newParent) : f.kind;
    const row = { id: c?.id, name, icon: custom || f.icon, color: f.color, kind, parentId: newParent, archived: fd.get('archived') === 'on', sort: c?.sort ?? st.categories.length };
    const saved = store.upsert('categories', row);
    if (!newParent && fd.has('budget') && kind !== 'fixed') {
      const raw = String(fd.get('budget') || '').trim();
      if (raw) {
        const amt = parseMoney(raw);
        need(amt !== null && amt >= 0, 'Enter a valid budget.');
        if (!c || amt !== curBudget) store.setBudget(saved.id, mk, amt, String(fd.get('scope') || 'from'));
      }
    }
    toast(c ? 'Category saved' : 'Category created');
  }, {
    onMount: (sh, form) => {
      const hint = form.querySelector('[data-kind-hint]');
      const syncKind = () => {
        if (hint) hint.textContent = { variable: 'Everyday spending with a monthly budget and pace tracking.', fixed: 'Recurring bills. Planned amounts come from the bills you schedule.', savings: 'Transfers to savings. The budget is your monthly savings target.' }[f.kind];
        const bud = form.querySelector('[data-budget]');
        if (bud) bud.classList.toggle('hidden', f.kind === 'fixed');
      };
      form.querySelectorAll('[data-kind] button').forEach(b => b.addEventListener('click', () => {
        f.kind = b.dataset.k; form.querySelectorAll('[data-kind] button').forEach(x => x.classList.toggle('on', x === b)); syncKind();
      }));
      syncKind();
      form.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => { f.icon = b.dataset.e; form.querySelector('[name="iconCustom"]').value = ''; form.querySelectorAll('[data-e]').forEach(x => x.classList.toggle('on', x === b)); }));
      form.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { f.color = b.dataset.c; form.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); }));
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        const n = st.transactions.filter(x => x.categoryId === c.id || idx.byId.get(x.categoryId)?.parentId === c.id).length;
        const others = st.categories.filter(x => x.id !== c.id && x.parentId !== c.id && !x.archived && idx.kindOf(x.id) === idx.kindOf(c.id));
        closeSheet();
        openSheet(`${sheetHeader(`Delete ${c.name}?`)}
          <p class="muted" style="margin:0 0 14px;line-height:1.5">${n} transaction${n === 1 ? '' : 's'}${hasChildren ? ' and its subcategories' : ''} will be moved. Budgets for this category are removed.</p>
          <form>${select('to', 'Move transactions to', [['', 'Uncategorized'], ...others.map(o => [o.id, `${o.icon || ''} ${o.name}`])], c.parentId || '')}
          <div class="btn-row"><button type="button" class="btn" data-act="closeSheet">Cancel</button><button type="submit" class="btn danger">Delete</button></div></form>`, {
          onMount: s2 => s2.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const to = new FormData(e.target).get('to') || null;
            store.deleteCategory(c.id, to);
            closeSheet();
            if (ui.page?.id === c.id) { ui.page = null; ui.pageStack = []; store.emit('change'); }
            toast('Category deleted');
          }),
        });
      });
    },
  });
  function computeBudget(cid, month) {
    return computeMonth(st, month, today()).lines.find(l => l.category.id === cid)?.budget || 0;
  }
}

export function openBudgetForm(categoryId, month) {
  const st = S(), idx = categoryIndex(st);
  const c = idx.byId.get(categoryId);
  if (!c) return;
  const line = computeMonth(st, month, today()).lines.find(l => l.category.id === categoryId);
  const hist = st.budgets.filter(b => b.categoryId === categoryId).sort((a, b) => (a.month < b.month ? 1 : -1));
  const html = `${sheetHeader(`${c.icon || ''} ${c.name} budget`)}
    ${money('amount', c.kind === 'savings' ? `Monthly savings target · ${fmtMonth(month)}` : `Budget for ${fmtMonth(month)}`, line?.budget ?? 0, { required: true })}
    ${select('scope', 'Apply to', [['from', `${fmtMonth(month)} and every month after`], ['only', `Only ${fmtMonth(month)} (leave other months alone)`]], 'from')}
    ${line && line.spent ? `<p class="hint">You've spent ${fmt(line.spent)} here in ${fmtMonth(month)}.</p>` : ''}
    ${hist.length ? `<span class="field-label">Budget history</span><div class="list" style="margin-bottom:14px">${hist.slice(0, 8).map(b => `<div class="row-item" style="min-height:44px"><div class="main"><div class="title" style="font-size:14px">${b.scope === 'only' ? `Only ${fmtMonth(b.month)}` : `From ${fmtMonth(b.month)}`}</div></div><div class="amt num">${fmt(b.amountCents)}</div></div>`).join('')}</div>` : ''}
    ${footer('Save budget')}`;
  formSheet(html, fd => {
    const amt = cents(fd, 'amount', { allowZero: true });
    store.setBudget(categoryId, month, amt, String(fd.get('scope')));
    toast('Budget saved');
  });
}

/* ====================================================================== */
/* GOALS                                                                  */
/* ====================================================================== */
const GOAL_EMOJI = ['🛟', '🏖️', '🗾', '🏠', '🚗', '💍', '🎓', '💻', '👶', '📈', '🎯', '🐷'];
export function openGoalForm(id) {
  const st = S();
  const g = id ? st.goals.find(x => x.id === id) : null;
  const f = { kind: g?.kind || 'target', icon: g?.icon || '🎯' };
  const html = `${sheetHeader(g ? 'Edit goal' : 'New savings goal')}
    <div class="toggle" data-gkind style="margin-bottom:14px"><button type="button" data-k="target" class="${f.kind === 'target' ? 'on' : ''}">Save toward an amount</button><button type="button" data-k="monthly" class="${f.kind === 'monthly' ? 'on' : ''}">Save every month</button></div>
    ${text('name', 'Goal name', g?.name || '', { placeholder: 'e.g. Emergency fund, Japan trip', required: true })}
    ${money('target', 'Target amount', g?.targetCents ?? null, { required: true })}
    <div data-tonly>${money('starting', 'Already saved', g?.startingCents ?? 0)}${date('targetDate', 'Target date (optional)', g?.targetDate || '')}</div>
    <p class="hint" data-mhint>Progress counts every transfer into a savings category this month.</p>
    <span class="field-label">Icon</span><div class="emoji-pick">${GOAL_EMOJI.map(e => `<button type="button" data-e="${e}" class="${e === f.icon ? 'on' : ''}">${e}</button>`).join('')}</div>
    ${g ? check('archived', 'Archive (hide)', g.archived) : ''}
    ${footer(g ? 'Save' : 'Create goal', g ? `<button type="button" class="btn danger" data-del style="flex:0 0 auto">${icon('trash')}</button>` : '')}`;
  formSheet(html, fd => {
    const name = String(fd.get('name') || '').trim();
    need(name, 'Name your goal.');
    const row = { id: g?.id, name, kind: f.kind, icon: f.icon, targetCents: cents(fd, 'target'), archived: fd.get('archived') === 'on' };
    if (f.kind === 'target') {
      row.startingCents = cents(fd, 'starting', { required: false, allowZero: true }) || 0;
      row.targetDate = nonEmpty(fd.get('targetDate'));
      if (row.targetDate) need(isValidISO(row.targetDate) && row.targetDate > today(), 'Pick a future target date.');
    } else { row.startingCents = 0; row.targetDate = null; }
    store.upsert('goals', row);
    toast(g ? 'Goal saved' : 'Goal created');
  }, {
    onMount: (sh, form) => {
      const sync = () => { form.querySelector('[data-tonly]').classList.toggle('hidden', f.kind !== 'target'); form.querySelector('[data-mhint]').classList.toggle('hidden', f.kind !== 'monthly'); };
      form.querySelectorAll('[data-gkind] button').forEach(b => b.addEventListener('click', () => { f.kind = b.dataset.k; form.querySelectorAll('[data-gkind] button').forEach(x => x.classList.toggle('on', x === b)); sync(); }));
      form.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => { f.icon = b.dataset.e; form.querySelectorAll('[data-e]').forEach(x => x.classList.toggle('on', x === b)); }));
      sync();
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: `Delete “${esc(g.name)}”?`, body: 'Contributions stay in your transactions but are no longer linked to this goal.', ok: 'Delete', danger: true });
        if (!ok) return;
        store.batch(tx => {
          for (const x of S().transactions) if (x.goalId === g.id) tx.upsert('transactions', { ...x, goalId: null });
          tx.remove('goals', g.id);
        });
        closeSheet(); toast('Goal deleted');
      });
    },
  });
}

export function openContribute(goalId) {
  const st = S(), idx = categoryIndex(st), t = today();
  const g = st.goals.find(x => x.id === goalId);
  const savs = idx.roots.filter(c => c.kind === 'savings' && !c.archived);
  if (!savs.length) { toast('Create a Savings category first'); return; }
  const f = { dir: 'in' };
  const html = `${sheetHeader(`${g.icon || '🎯'} ${g.name}`)}
    <div class="toggle" data-dir style="margin-bottom:14px"><button type="button" data-k="in" class="on">Add to goal</button><button type="button" data-k="out">Withdraw</button></div>
    ${money('amount', 'Amount', null, { required: true })}
    ${date('date', 'Date', t, { required: true })}
    ${savs.length > 1 ? select('cat', 'Savings account', savs.map(c => [c.id, c.name]), savs[0].id) : ''}
    <p class="hint">Recorded as a transfer from checking to savings: it lowers your checking balance but isn't counted as spending.</p>
    ${footer('Save')}`;
  formSheet(html, fd => {
    const c = cents(fd, 'amount');
    const dt = String(fd.get('date'));
    need(isValidISO(dt), 'Pick a date.');
    store.upsert('transactions', { kind: 'expense', date: dt, amountCents: f.dir === 'in' ? c : -c, categoryId: String(fd.get('cat') || savs[0].id), goalId: g.id, merchant: f.dir === 'in' ? `Transfer to ${g.name}` : `Withdrawal from ${g.name}` });
    toast(f.dir === 'in' ? `Added ${fmt(c)} to ${g.name}` : `Withdrew ${fmt(c)}`);
  }, {
    onMount: (sh, form) => form.querySelectorAll('[data-dir] button').forEach(b => b.addEventListener('click', () => { f.dir = b.dataset.k; form.querySelectorAll('[data-dir] button').forEach(x => x.classList.toggle('on', x === b)); })),
  });
}

export function openGoalHistory(goalId, rowFn) {
  const st = S(), idx = categoryIndex(st);
  const g = st.goals.find(x => x.id === goalId);
  const txs = st.transactions.filter(x => x.goalId === goalId).sort((a, b) => (a.date < b.date ? 1 : -1));
  openSheet(`${sheetHeader(`${g.name} — history`)}${txs.length ? `<div class="list">${txs.map(x => rowFn(x, idx)).join('')}</div>` : '<div class="empty"><p>No contributions yet.</p></div>'}
    <p class="hint" style="margin-top:8px">Starting balance: ${fmt(g.startingCents || 0)}</p>`);
}

/* ====================================================================== */
/* SETTINGS FORMS                                                         */
/* ====================================================================== */
export function openBalanceForm(currentCents) {
  const t = today();
  const html = `${sheetHeader('Current checking balance')}
    <p class="muted" style="margin:-4px 0 16px;line-height:1.5">Open your bank app and enter exactly what it shows as available right now. Runway tracks changes from here and you can re-sync it any time.</p>
    ${money('amount', 'Balance right now', currentCents ?? null, { required: true })}
    ${date('date', 'As of', t, { required: true })}
    <p class="hint">Transactions you log after this point adjust the balance. Ones dated earlier are assumed to be already included.</p>
    ${footer('Save balance')}`;
  formSheet(html, fd => {
    const raw = String(fd.get('amount') || '').trim();
    const c = parseMoney(raw);
    need(c !== null, 'Enter your balance (it can be negative).');
    const d = String(fd.get('date'));
    need(isValidISO(d) && d <= t, 'Pick today or an earlier date.');
    store.setBalance(c, d);
    toast('Balance updated');
  });
}

export function openBufferForm() {
  const s = S().settings;
  const html = `${sheetHeader('Safety buffer')}
    <p class="muted" style="margin:-4px 0 16px;line-height:1.5">A cushion that's never counted as spendable — protection against a surprise charge or a late paycheck.</p>
    ${money('amount', 'Keep at least', s.bufferCents || 0, { required: true })}
    ${footer('Save')}`;
  formSheet(html, fd => { store.updateSettings({ bufferCents: cents(fd, 'amount', { allowZero: true }) }); toast('Buffer saved'); });
}

/* ====================================================================== */
/* AUTH                                                                   */
/* ====================================================================== */
export function openAuthForm({ onSession, mode = 'signin' } = {}) {
  const f = { mode };
  const html = `${sheetHeader('Sync with your account')}
    <div class="toggle" data-amode style="margin-bottom:14px"><button type="button" data-k="signin" class="${mode === 'signin' ? 'on' : ''}">Sign in</button><button type="button" data-k="signup" class="${mode === 'signup' ? 'on' : ''}">Create account</button></div>
    <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" autocapitalize="off" required></label>
    <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" minlength="8" required></label>
    <p class="hint" data-ahint>Your data is private to your account (row-level security).</p>
    <button type="button" class="btn ghost sm" data-forgot style="color:var(--green);margin:-6px 0 6px">Forgot password?</button>
    ${footer('Continue')}`;
  formSheet(html, async (fd, form) => {
    const { cloud } = await import('./cloud.js');
    const email = String(fd.get('email') || '').trim(), pw = String(fd.get('password') || '');
    need(/.+@.+\..+/.test(email), 'Enter a valid email.');
    need(pw.length >= 8, 'Password must be at least 8 characters.');
    form.querySelector('[type="submit"]').disabled = true;
    try {
      if (f.mode === 'signup') {
        const res = await cloud.signUp(email, pw);
        if (!res.session) {
          form.querySelector('[data-err]').innerHTML = `<span class="good">Check ${esc(email)} for a confirmation link, then come back and sign in.</span>`;
          return false;
        }
        await onSession(res.session);
      } else {
        const session = await cloud.signIn(email, pw);
        await onSession(session);
      }
    } finally { form.querySelector('[type="submit"]').disabled = false; }
  }, {
    onMount: (sh, form) => {
      form.querySelectorAll('[data-amode] button').forEach(b => b.addEventListener('click', () => {
        f.mode = b.dataset.k; form.querySelectorAll('[data-amode] button').forEach(x => x.classList.toggle('on', x === b));
        form.querySelector('[name="password"]').autocomplete = f.mode === 'signup' ? 'new-password' : 'current-password';
        form.querySelector('[type="submit"]').textContent = f.mode === 'signup' ? 'Create account' : 'Sign in';
      }));
      form.querySelector('[type="submit"]').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
      form.querySelector('[data-forgot]').addEventListener('click', async () => {
        const email = form.querySelector('[name="email"]').value.trim();
        const err = form.querySelector('[data-err]');
        if (!/.+@.+\..+/.test(email)) { err.textContent = 'Enter your email above first.'; return; }
        try { const { cloud } = await import('./cloud.js'); await cloud.resetPassword(email); err.innerHTML = '<span class="good">Password reset email sent.</span>'; }
        catch (e) { err.textContent = e.message; }
      });
    },
  });
}

export function openPasswordForm() {
  formSheet(`${sheetHeader('Change password')}<label class="field"><span>New password</span><input class="input" type="password" name="pw" autocomplete="new-password" minlength="8"></label>${footer('Update password')}`, async fd => {
    const pw = String(fd.get('pw') || '');
    need(pw.length >= 8, 'At least 8 characters.');
    const { cloud } = await import('./cloud.js');
    await cloud.updatePassword(pw);
    toast('Password updated');
  });
}
