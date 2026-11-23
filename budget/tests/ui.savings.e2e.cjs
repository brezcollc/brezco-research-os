// Savings-first features end-to-end (device-only mode). Run: node budget/tests/ui.savings.e2e.cjs
const { open } = require('./harness.cjs');
const assert = require('assert');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
let failed = 0;
const num = s => Number(String(s).replace(/[^\d.\-−]/g, '').replace('−', '-'));
(async () => {
  const { b, p, errs } = await open({ today: '2026-11-27' }); // a Friday payday
  const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { failed++; console.log('✗', name, '\n   ', e.message.split('\n')[0]); await p.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W/g, '_')}.png`, fullPage: true }); } };
  const closeToast = () => p.evaluate(() => { document.getElementById('toast-root').innerHTML = ''; });
  const done = () => p.waitForSelector('.sheet', { state: 'detached' });
  const state = () => p.evaluate(() => JSON.parse(localStorage.getItem('runway.v1.local.data')));

  await step('setup: balance, biweekly paycheck (today), rent, dining budget', async () => {
    await p.click('text=Use on this device only'); await p.waitForSelector('.hero');
    await p.click('text=Set your current balance'); await p.fill('.sheet [name="amount"]', '1500'); await p.click('.sheet button[type="submit"]'); await done();
    await p.click('text=Add your paycheck'); await p.fill('.sheet [name="name"]', 'Paycheck'); await p.fill('.sheet [name="amount"]', '2500');
    await p.fill('.sheet [name="anchorDate"]', '2026-11-27'); await p.click('.sheet button[type="submit"]'); await done();
    await p.click('text=Add recurring bills'); await p.fill('.sheet [name="name"]', 'Rent'); await p.fill('.sheet [name="amount"]', '1500');
    await p.click('.sheet button[type="submit"]'); await done();
    await closeToast();
  });
  await step('set a 30% savings target from the dashboard', async () => {
    await p.click('.hero.save [data-act="editTarget"]');
    await p.click('.sheet [data-pct="30"]');
    await p.waitForSelector('.sheet [data-preview]:has-text("of $5,000.00 expected")'); // Nov 13 + Nov 27 paychecks
    await p.click('.sheet button[type="submit"]'); await done();
    await p.waitForSelector('.hero.save .pill:has-text("TARGET")');
  });
  await step('schedule $400 to Brokerage every payday', async () => {
    await closeToast();
    await p.click('.hero.save [data-seg="goals"]');
    await p.click('button:has-text("Schedule a transfer")');
    await p.fill('.sheet [name="amount"]', '400');
    await p.fill('.sheet [name="name"]', 'Brokerage');
    assert.match(await p.locator('.sheet [name="sched"] option:checked').innerText(), /Every payday/);
    await p.screenshot({ path: `${SHOTS}/savings-transfer-form.png` });
    await p.click('.sheet button[type="submit"]'); await done();
    await p.waitForSelector('.row-item:has-text("Brokerage") >> text=Every payday');
  });
  await step('transfer is reserved before safe-to-spend', async () => {
    const st = await state();
    assert.equal(st.bills.length, 2);
    // Starts today: only the Nov 27 payday transfer counts this month ($400), not Nov 13
    await p.click('.nav button[data-tab="dashboard"]');
    await p.click('details summary');
    const kv = (await p.locator('details .kv').allInnerTexts()).map(s => s.replace(/\n/g, ' '));
    assert.ok(kv.some(s => /Savings still to move .*400\.00/.test(s)), kv.join(' | '));
  });
  await step('one tap "Moved it" records the transfer; Undo removes it', async () => {
    await closeToast();
    await p.click('.insight:has-text("Pay yourself first") >> text=Moved it');
    await p.waitForSelector('.toast:has-text("Moved $400.00")');
    let st = await state();
    const moved = st.transactions.filter(t => t.billId);
    assert.equal(moved.length, 1);
    assert.equal(moved[0].amountCents, 40000);
    await p.click('.toast button'); // undo
    st = await state();
    assert.equal(st.transactions.filter(t => t.billId).length, 0);
    await p.click('.insight:has-text("Pay yourself first") >> text=Moved it'); // do it for real
    await closeToast();
    await p.waitForSelector('.hero.save .meta:has-text("$400.00 moved")');
  });
  await step('savings hero shows correct projection', async () => {
    // income 5,000 expected; rent 1,500 unpaid; no discretionary spending → keep 3,500 (70%)
    const big = num(await p.locator('.hero.save .big').innerText());
    assert.equal(big, 3500);
    assert.match(await p.locator('.hero.save .meta').first().innerText(), /70% of take-home/);
    await p.screenshot({ path: `${SHOTS}/savings-dashboard.png`, fullPage: true });
  });
  await step('"Make this recurring" turns a logged charge into a linked bill', async () => {
    await p.click('.fab'); await p.fill('.sheet [name="amount"]', '15.49'); await p.fill('.sheet [name="merchant"]', 'Netflix');
    await p.click('.sheet .cat-grid button >> text=More');
    await p.click('.sheet .cat-grid button:has-text("Subscriptions")');
    await p.click('.sheet button[type="submit"]'); await done(); await closeToast();
    await p.click('.nav button[data-tab="transactions"]');
    await p.click('.row-item:has-text("Netflix")');
    await p.click('.sheet [data-recurring]');
    await p.waitForSelector('.sheet h2:has-text("Add recurring bill")');
    assert.equal(await p.inputValue('.sheet [name="name"]'), 'Netflix');
    assert.equal(await p.inputValue('.sheet [name="amount"]'), '15.49');
    assert.equal(await p.inputValue('.sheet [name="dayOfMonth"]'), '27');
    await p.click('.sheet button[type="submit"]'); await done();
    const st = await state();
    const bill = st.bills.find(x => x.name === 'Netflix');
    assert.ok(bill);
    const t = st.transactions.find(x => x.merchant === 'Netflix');
    assert.equal(t.billId, bill.id);
    assert.equal(t.billDate, '2026-11-27');
    await p.click('.nav button[data-tab="budget"]'); await p.click('.seg button[data-seg="bills"]');
    await p.waitForSelector('.row-item:has-text("Netflix") >> text=Paid');
  });
  await step('month-end sweep moves unspent budget to savings', async () => {
    await p.goto(p.url().replace('2026-11-27', '2026-11-29'));
    await p.waitForSelector('.hero');
    // A realistic month: both paychecks confirmed, rent paid.
    await p.click('.nav button[data-tab="budget"]'); await p.click('.seg button[data-seg="income"]');
    while (await p.locator('[data-act="receiveIncome"]:has-text("Confirm")').count()) {
      await p.click('[data-act="receiveIncome"]:has-text("Confirm") >> nth=0'); await p.click('.sheet button[type="submit"]'); await done(); await closeToast();
    }
    await p.click('.seg button[data-seg="bills"]');
    await p.click('.row-item:has-text("Rent") [data-act="payBill"]'); await p.click('.sheet button[type="submit"]'); await done(); await closeToast();
    // give Dining Out a $300 budget, spend $100
    await p.click('.nav button[data-tab="budget"]'); await p.click('.seg button[data-seg="spending"]');
    await p.click('.cat-row:has-text("Dining Out")'); await p.click('text=Set budget');
    await p.fill('.sheet [name="amount"]', '300'); await p.click('.sheet button[type="submit"]'); await done();
    await p.click('[data-act="addTx"][data-cat]'); await p.fill('.sheet [name="amount"]', '100'); await p.click('.sheet button[type="submit"]'); await done();
    await closeToast();
    await p.click('.nav button[data-tab="dashboard"]');
    const showAll = p.locator('[data-act="toggleInsights"]');
    if (await showAll.count()) await showAll.click();
    await p.waitForSelector('.insight:has-text("left over this month")');
    await p.click('.insight button:has-text("Move it to savings")');
    assert.equal(await p.inputValue('.sheet [name="amount"]'), '200.00');
    await p.click('.sheet button[type="submit"]'); await done();
    await closeToast();
    assert.equal(await p.locator('.insight:has-text("left over this month")').count(), 0);
    const safe = num(await p.locator('.stat:has-text("Available to spend") .value').innerText());
    assert.equal(safe, 0);
  });
  await step('analytics shows the target line; every screen renders', async () => {
    for (const t of ['transactions', 'budget', 'analytics', 'settings', 'dashboard']) await p.click(`.nav button[data-tab="${t}"]`);
    await p.click('.nav button[data-tab="analytics"]');
    await p.waitForSelector('text=Your 30% target');
    await p.click('.nav button[data-tab="budget"]'); await p.click('.seg button[data-seg="goals"]');
    await p.screenshot({ path: `${SHOTS}/savings-tab.png`, fullPage: true });
    assert.equal(errs.length, 0, errs.join('\n'));
  });
  console.log(errs.length ? 'console errors:\n' + errs.join('\n') : 'no console errors');
  await b.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
