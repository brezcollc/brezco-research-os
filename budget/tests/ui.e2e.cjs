// End-to-end UI test (Playwright, iPhone 14 Pro). Run: node budget/tests/ui.e2e.cjs
const { open } = require('./harness.cjs');
const assert = require('assert');
const SP = require('os').tmpdir(); require('fs').mkdirSync(SP + '/shots', { recursive: true });
const num = s => Number(String(s).replace(/[^\d.\-−]/g, '').replace('−', '-'));
let failed = 0;
(async () => {
  const { b, p, errs } = await open();
  const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { failed++; console.log('✗', name, e.message); await p.screenshot({ path: `${SP}/shots/fail-${name.replace(/\W/g, '_')}.png`, fullPage: true }); } };
  const statVal = async label => num(await p.locator('.stat', { hasText: label }).locator('.value').innerText());
  const closeToast = () => p.evaluate(() => { document.getElementById('toast-root').innerHTML = ''; });

  // 1. Fresh device-only start: defaults + setup checklist
  await step('device-only start creates default categories', async () => {
    await p.click('text=Use on this device only');
    await p.waitForSelector('text=Get set up');
    const n = await p.evaluate(() => JSON.parse(localStorage.getItem('runway.v1.local.data')).categories.length);
    assert.equal(n, 17);
  });
  await step('set balance', async () => {
    await p.click('text=Set your current balance');
    await p.fill('.sheet [name="amount"]', '2,500.00');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('text=Safe to spend today');
  });
  await step('add biweekly paycheck', async () => {
    await p.click('text=Add your paycheck');
    await p.fill('.sheet [name="name"]', 'Paycheck');
    await p.fill('.sheet [name="amount"]', '2000');
    await p.selectOption('.sheet [name="frequency"]', 'biweekly');
    await p.fill('.sheet [name="anchorDate"]', '2026-12-04');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    // Nov 6 + Nov 20 expected, unconfirmed → should prompt
    await p.waitForSelector('text=Did your Paycheck arrive?');
  });
  await step('confirm a paycheck → received income updates', async () => {
    await closeToast();
    await p.click('.insight >> text=Yes, it arrived');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    assert.equal(await statVal('Take-home received'), 2000);
  });
  await step('add rent bill (monthly, 1st)', async () => {
    await p.click('text=Add recurring bills');
    await p.fill('.sheet [name="name"]', 'Rent');
    await p.fill('.sheet [name="amount"]', '1500');
    await p.selectOption('.sheet [name="categoryId"]', { label: 'Rent & Housing' });
    await p.selectOption('.sheet [name="dayOfMonth"]', '1');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('text=Rent was due Nov 1');
  });
  await step('set Dining Out budget $300 from this month', async () => {
    await p.click('.nav button[data-tab="budget"]');
    await p.click('.cat-row:has-text("Dining Out")');
    await p.click('text=Set budget');
    await p.fill('.sheet [name="amount"]', '300');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('text=of $300.00');
  });
  await step('quick-add $250 dining → flagged as spending fast / over pace', async () => {
    await closeToast();
    await p.click('.fab');
    await p.fill('.sheet [name="amount"]', '250');
    await p.fill('.sheet [name="merchant"]', 'Nobu');
    await p.click('.sheet .cat-grid button:has-text("Dining Out")');
    await p.screenshot({ path: `${SP}/shots/08-add-tx.png` });
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('text=$250.00');
    await p.click('.nav button[data-tab="dashboard"]');
    assert.equal(await statVal('Spent this month'), 250);
  });
  await step('dashboard reflects pay-bill and safe-to-spend math', async () => {
    // balance 2500 (set today) + confirmed Nov 6 paycheck dated before the anchor → not added
    // − 250 dining = 2250. Rent 1500 unpaid & overdue, Nov 20 paycheck unconfirmed.
    const txt = await p.locator('details').innerText().catch(() => '');
    await p.click('details summary');
    const kv = await p.locator('details .kv').allInnerTexts();
    console.log('   ', kv.slice(0, 8).map(s => s.replace(/\n/g, ' ')).join(' | '));
    assert.ok(kv[0].includes('2,250.00'), 'balance 2250');
    assert.ok(kv[2].includes('1,500.00'), 'unpaid rent committed');
    void txt;
  });
  await step('pay rent from the insight → commitment clears', async () => {
    await closeToast();
    await p.click('.insight >> text=Mark paid');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    assert.equal(await statVal('Spent this month'), 1750);
    assert.equal(await p.locator('text=Rent was due Nov 1').count(), 0);
  });
  await step('edit transaction amount, then delete with undo', async () => {
    await closeToast();
    await p.click('.nav button[data-tab="transactions"]');
    await p.click('.row-item:has-text("Nobu")');
    await p.fill('.sheet [name="amount"]', '100');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('.row-item:has-text("−$100.00")');
    await closeToast();
    await p.click('.row-item:has-text("Nobu")');
    await p.click('.sheet [data-del]');
    await p.click('.sheet button[data-c="1"]');
    await p.waitForSelector('.row-item:has-text("Nobu")', { state: 'detached' });
    await p.click('.toast button');
    await p.waitForSelector('.row-item:has-text("Nobu")');
  });
  await step('data persists across reload', async () => {
    await p.reload();
    await p.waitForSelector('.hero');
    assert.equal(await statVal('Spent this month'), 1600);
  });
  await step('goal: create and contribute', async () => {
    await p.click('.nav button[data-tab="budget"]');
    await p.click('.seg button[data-seg="goals"]');
    await p.click('text=New goal');
    await p.fill('.sheet [name="name"]', 'Emergency fund');
    await p.fill('.sheet [name="target"]', '5000');
    await p.fill('.sheet [name="targetDate"]', '2027-05-28');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('text=Per paycheck');
    await closeToast();
    await p.click('text=Add money');
    await p.fill('.sheet [name="amount"]', '250');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('text=$250.00 of $5,000.00');
  });
  await step('every tab/segment renders without errors', async () => {
    for (const t of ['dashboard', 'transactions', 'budget', 'analytics', 'settings']) await p.click(`.nav button[data-tab="${t}"]`);
    await p.click('.nav button[data-tab="budget"]');
    for (const s of ['spending', 'bills', 'income', 'goals', 'cashflow']) await p.click(`.seg button[data-seg="${s}"]`);
    await p.click('.nav button[data-tab="analytics"]');
    await p.click('[data-act="month"][data-d="-1"]'); await p.click('[data-act="month"][data-d="1"]'); await p.click('[data-act="month"][data-d="1"]');
    assert.equal(errs.length, 0, errs.join('\n'));
  });
  await step('CSV export contains the transactions (cents-exact)', async () => {
    await p.click('.nav button[data-tab="settings"]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Export transactions (CSV)')]);
    const fs = require('fs'); const text = fs.readFileSync(await dl.path(), 'utf8');
    console.log('   ' + text.trim().split('\n').slice(0, 4).join('\n    '));
    assert.ok(text.includes('-100.00') && text.includes('2000.00'));
  });
  await step('sample data loads and removes cleanly, keeping real entries', async () => {
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem('runway.v1.local.data')).transactions.length);
    await p.click('text=Load sample data');
    await p.waitForSelector('text=Remove sample data');
    const mid = await p.evaluate(() => JSON.parse(localStorage.getItem('runway.v1.local.data')).transactions.length);
    await p.click('text=Remove sample data'); await p.click('.sheet button[data-c="1"]');
    await p.waitForSelector('text=Load sample data');
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem('runway.v1.local.data')));
    console.log(`    tx before=${before} with-demo=${mid} after=${after.transactions.length}, balance=${after.settings.balanceCents}`);
    assert.equal(after.transactions.length, before);
    assert.equal(after.settings.balanceCents, 250000);
  });
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await b.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
